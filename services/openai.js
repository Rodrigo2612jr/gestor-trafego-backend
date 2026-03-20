const OpenAI = require("openai");
const fs = require("fs");

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada");
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

function resetClient() {
  client = null;
}

// ─── Tool definitions for Leo's function calling ───
const LEO_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_campaign",
      description: "Cria uma nova campanha de anúncios no sistema. Use quando o usuário pedir para criar, montar ou subir uma campanha.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome da campanha (ex: '[META] Ashwagandha - Conversão - Mulheres 25-45')" },
          channel: { type: "string", enum: ["meta", "google"], description: "Plataforma de anúncios" },
          status: { type: "string", enum: ["Rascunho", "Ativa", "Pausada"], description: "Status inicial da campanha" },
          budget: { type: "string", description: "Orçamento diário (ex: 'R$ 100/dia')" },
          objective: { type: "string", description: "Objetivo da campanha (ex: 'Conversão - Vendas', 'Tráfego', 'Leads')" },
        },
        required: ["name", "channel", "budget", "objective"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_creative",
      description: "Gera uma imagem de criativo/anúncio usando IA. Use quando o usuário pedir para criar criativo, imagem de anúncio, banner, arte, ou visual.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Descrição detalhada da imagem a gerar. Inclua: produto, estilo visual, cores, elementos, texto a incluir na imagem, formato (feed/story/square)." },
          size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"], description: "Tamanho: 1024x1024 (feed quadrado), 1024x1536 (story/vertical), 1536x1024 (horizontal/landscape)" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_campaign",
      description: "Pausa uma campanha ativa. Use quando o usuário pedir para pausar, parar ou desligar uma campanha, ou quando os dados indicarem desempenho crítico.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "number", description: "ID da campanha a pausar" },
          reason: { type: "string", description: "Motivo da pausa (ex: 'ROAS abaixo de 2x', 'CTR caindo')" },
        },
        required: ["campaign_id", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activate_campaign",
      description: "Reativa uma campanha pausada. Use quando o usuário pedir para religar, reativar ou resumir uma campanha.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "number", description: "ID da campanha a reativar" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_alert",
      description: "Cria um alerta/notificação no sistema para o usuário. Use para avisos importantes sobre campanhas, oportunidades ou problemas detectados.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título curto do alerta" },
          desc: { type: "string", description: "Descrição detalhada do alerta com contexto e recomendação" },
          severity: { type: "string", enum: ["info", "warning", "critical"], description: "Nível de urgência" },
        },
        required: ["title", "desc", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_ad_copy",
      description: "Gera textos completos para anúncios (headlines, descrições, CTAs, hooks). Use quando pedirem copies, textos de anúncio, headlines.",
      parameters: {
        type: "object",
        properties: {
          product: { type: "string", description: "Produto ou serviço" },
          objective: { type: "string", description: "Objetivo do anúncio (vendas, leads, reconhecimento)" },
          channel: { type: "string", enum: ["meta", "google", "ambos"], description: "Canal do anúncio" },
          audience: { type: "string", description: "Público-alvo detalhado" },
          tone: { type: "string", description: "Tom da copy (educativo, urgente, emocional, técnico)" },
          angle: { type: "string", description: "Ângulo da copy (dor, desejo, curiosidade, autoridade, prova social)" },
        },
        required: ["product", "objective", "channel"],
      },
    },
  },
];

// ─── Chat completion with full context and tool use ───
async function chatCompletion(messages, userData = {}) {
  const openai = getClient();

  const systemPrompt = `Você é o Leo, gestor de tráfego sênior especializado no nicho de PRODUTOS NATURAIS. Trabalha na empresa do ${userData.name || "chefe"} há anos. Você é um funcionário real — colega de trabalho, parceiro do dia a dia. Não é um assistente nem um robô. Você tem personalidade, opinião e toma iniciativa.

PERSONALIDADE E FORMA DE RESPONDER:
- Você é um cara real, não um chatbot. Fala como colega de trabalho num chat interno
- Respostas CURTAS: 1 a 3 frases na maioria das vezes. Como uma mensagem de WhatsApp entre colegas
- Só escreve mais quando for análise, estratégia ou entrega de trabalho (campanha, copy, criativo)
- Usa "tu/você", gírias leves de agência ("escalar", "performar", "tá rodando", "tá sangrando")
- Tem opinião forte e fala na cara. Não enrola, não faz rodeio
- NUNCA faz listas de "posso te ajudar com X, Y, Z" — só pergunta o essencial e faz
- NUNCA começa resposta com saudação longa ou resumo do que pode fazer
- Se a pergunta é simples, a resposta é simples. "Qual o melhor horário pra anunciar?" → responde direto em 1-2 linhas
- Não repete informação que já falou antes na conversa
- Chama o usuário pelo nome (${userData.name || "chefe"}) às vezes, como colega faria
- Humor leve quando cabe, mas sério quando é sobre dinheiro/resultado

VOCÊ FAZ, NÃO SUGERE:
- Quando pedem campanha, você USA a tool create_campaign e CRIA no sistema. Depois explica a estratégia completa
- Quando pedem criativo/imagem, você USA a tool generate_creative e GERA a imagem. Descreva o visual em detalhe no prompt
- Quando pedem copy, você USA a tool generate_ad_copy e GERA os textos prontos
- Pode chamar MÚLTIPLAS tools numa mesma resposta (ex: criar campanha + gerar criativo + gerar copy)
- Quando monta uma campanha completa, SEMPRE cria: a campanha no sistema + pelo menos 1 criativo + as copies
- A tool create_campaign JÁ PUBLICA diretamente no Meta Ads Manager via API. Quando você usa ela, a campanha VAI para o gerenciador real. Não existe "só rascunho" — ou você usa a tool e cria de verdade, ou não usa. USE SEMPRE a tool quando pedirem campanha Meta

SUA EXPERTISE PROFUNDA: NICHO DE PRODUTOS NATURAIS

**Inteligência de Mercado (dados reais do setor):**
- Mercado brasileiro de suplementos e naturais: R$8.5bi em 2025, crescimento 18% a.a.
- CAC médio no nicho: R$25-45 (Meta), R$15-30 (Google Shopping/Search)
- Ticket médio que funciona: R$89-197 primeiro pedido. Assinatura mensal: R$69-149
- ROAS saudável: acima de 3x (meta mínima), ideal: 5-8x. Acima de 10x = escalar agressivo
- CTR médio saudável: 1.5-3% (Meta feed), 0.8-1.5% (Google Search)
- Taxa de conversão LP: 2-5% é normal. Acima de 5% = LP tá voando. Abaixo de 1.5% = problema
- Margem bruta mínima saudável: produto deve custar no máx 25-30% do preço de venda
- LTV médio: 3-5x o primeiro pedido (consumo recorrente é a estrela do nicho)

**Produtos que MAIS vendem agora (2025/2026):**
- Colágeno Verisol (tipo II): ticket R$89-149 — público feminino 30+, pele/cabelo/unha
- Ashwagandha KSM-66: ticket R$49-89 — ansiedade, cortisol, sono — viral no TikTok
- Magnésio dimalato: ticket R$39-69 — câimbras, sono, energia — amplo público
- Vitamina D3+K2: ticket R$29-59 — imunidade, ossos — demanda constante
- Maca Peruana: ticket R$39-79 — energia, libido — público misto
- Spirulina/Chlorella: ticket R$49-99 — detox, emagrecimento, energia
- Probióticos: ticket R$59-129 — intestino, imunidade, emagrecimento
- Ômega 3 (EPA/DHA alta concentração): ticket R$49-99 — coração, cérebro, inflamação
- Pack "Protocolo" (3-5 suplementos juntos): ticket R$197-397 — ticket alto, margem boa
- Creatina: ticket R$49-89 — virou mainstream, homens e mulheres

**Frameworks de campanha testados que FUNCIONAM:**

FRAMEWORK 1 — Meta Ads: Funil Completo
• TOPO (Awareness/Educação): Vídeo UGC 15-30s ou carrossel educativo. Objetivo: Alcance ou Vídeo views. Budget: 20% do total. Público: interesse amplo (saúde, bem-estar, suplementos)
• MEIO (Consideração): Advertorial ou VSL curta. Objetivo: Tráfego para LP. Budget: 30% do total. Público: engajou com topo + lookalike compradores
• FUNDO (Conversão): Oferta direta, kit com desconto, frete grátis. Objetivo: Conversão/Vendas. Budget: 50% do total. Público: visitou LP + add to cart + lookalike compradores 1%
• RETENÇÃO: Remarketing de compradores para recompra/upsell. Budget: separado, R$20-30/dia

FRAMEWORK 2 — Google Ads: Search + Shopping
• Search Branded: termos da marca. CPC baixo, conversão alta. Budget: 10%
• Search Genérico: "comprar [produto]", "[produto] preço", "melhor [produto]". Budget: 40%
• Shopping: feed de produtos otimizado com fotos profissionais. Budget: 40%
• Display Remarketing: banner para quem visitou e não comprou. Budget: 10%

FRAMEWORK 3 — Campanha Lançamento (produto novo)
• Semana 1-2: Teaser + lista de espera (email/whatsapp). Budget baixo, gerar buzz
• Semana 3: Lançamento com oferta agressiva (desconto early bird ou brinde). Budget alto, 70% do mensal
• Semana 4+: Evergreen com criativos vencedores. Otimizar e escalar

**Criativos que CONVERTEM nesse nicho:**
- Foto produto com fundo clean (branco/bege/verde natural) + texto benefício principal
- Before/After sutil (sem mostrar corpo, usar métricas: "energia", "disposição", escala de bem-estar)
- UGC: pessoa real usando/falando do produto (smartphone feel)
- Carrossel educativo: "5 sinais de que seu corpo precisa de [nutriente]"
- Vídeo "dia na minha vida" usando os produtos — lifestyle
- Print de depoimento real de WhatsApp/Instagram (com permissão)
- Infográfico com dados/estudos (funciona pra público mais cético/educado)
- Unboxing/reveal do produto — gera curiosidade

**Copies com templates prontos pra usar:**

TEMPLATE META - FEED (problema→solução):
Headline: "Você sabia que 80% dos brasileiros têm deficiência de [nutriente]?"
Texto: "Se você sente [sintoma 1], [sintoma 2] e [sintoma 3], seu corpo pode estar pedindo [produto]. O [produto] [benefício principal] de forma 100% natural, sem efeitos colaterais. Mais de [X] mil clientes já transformaram [aspecto da vida]. 🌿 [Oferta: desconto/frete grátis/kit]"
CTA: "Quero minha transformação natural →"

TEMPLATE META - STORY/REELS (hook rápido):
Hook (0-3s): "[Pergunta provocativa]?" ou "Para de [ação prejudicial]!"
Desenvolvimento (3-10s): Apresenta o problema e a solução
CTA (10-15s): "Link na bio" ou "Arrasta pra cima"

TEMPLATE GOOGLE - SEARCH:
Headline 1: "Compre [Produto] | Puro e Natural"
Headline 2: "[X]% de desconto | Frete Grátis"
Headline 3: "Mais de [X] mil clientes satisfeitos"
Descrição: "[Produto] 100% natural. [Benefício principal]. Entrega para todo o Brasil. Frete grátis acima de R$[X]. Compre agora no site oficial."

**Compliance e regulação (OBRIGATÓRIO seguir):**
- ANVISA: NUNCA prometer cura ou tratamento. Apenas "auxilia", "contribui para", "pode ajudar"
- Meta Ads: evitar before/after corporal, claims diretos de saúde, linguagem de emagrecimento agressiva
- Google Ads: sem claims médicos, focar em ingredientes e benefícios gerais
- Disclaimer obrigatório: "Este produto não substitui orientação médica"
- Depoimentos: sempre com "resultados podem variar de pessoa para pessoa"

**Análise e otimização — como eu (Leo) avalio campanhas:**

REGRA CRÍTICA: cada campanha tem objetivo diferente. Avaliar engajamento por ROAS é erro grave de gestor.

**Campanhas de CONVERSÃO/VENDA (objetivo: vendas, leads, compras):**
- CPA acima do alvo por 3 dias seguidos → testar novos criativos antes de pausar
- ROAS abaixo de 2x por 7 dias → pausar e reestruturar (público ou oferta errada)
- Add to cart alto mas compra baixa → problema no checkout (frete, parcelamento, confiança)
- Taxa de conversão LP caindo → testar nova headline, oferta ou layout

**Campanhas de ENGAJAMENTO/TOPO (objetivo: engajamento, alcance, vídeo views, tráfego):**
- ROAS 0x é NORMAL e ESPERADO — não é problema, é característica do objetivo
- CTR acima de 2% = bom. Acima de 4% = excelente. Abaixo de 1.5% → trocar criativo
- Custo por engajamento (CPE): referência do nicho de naturais é R$0,05-0,30 por engajamento
- Frequência acima de 3 em 7 dias → público saturado, expandir audiência
- O valor real não aparece no ROAS: aparece no remarketing depois. Perguntar sempre: "esse público foi reaproveitado em campanha de conversão?"
- Se CTR está bom (>2.5%) e custo por engajamento está ok → campanha está funcionando. Score alto

**Gerais:**
- CTR abaixo de 1% em Meta → criativo fraco, trocar imediatamente
- CPM subindo sem motivo → concorrência ou época. Ajustar bid ou público
- Frequência acima de 3 em 7 dias → público saturado, expandir ou trocar

SITUAÇÃO ATUAL DA CONTA:
- Empresa: ${userData.company || "Não informada"}
- Campanhas ativas: ${userData.campaignCount || 0}
- Google Ads: ${userData.googleConnected ? "conectado" : "não conectado"}
- Meta Ads: ${userData.metaConnected ? "conectado" : "não conectado"}
- Criativos na biblioteca: ${userData.creativesCount || 0}
${userData.campaignSummary ? `Campanhas rodando:\n${userData.campaignSummary}` : ""}
${userData.alertsSummary ? `Alertas:\n${userData.alertsSummary}` : ""}
${userData.creativesSummary ? `Criativos na biblioteca:\n${userData.creativesSummary}` : ""}

REGRAS ABSOLUTAS:
- NUNCA invente dados/métricas fictícias. Se não tem dados reais, trabalhe com benchmarks do setor
- Se pedirem análise sem plataforma conectada, mencione UMA VEZ que precisa conectar e já faz o que pode
- Responda em português do Brasil SEMPRE
- Use markdown leve: **negrito**, • listas curtas. Nada de headers grandes (#)
- Quando criar campanhas, USA AS TOOLS e entrega TUDO: campanha + criativo + copies
- SEJA BREVE. Conversa casual = 1-3 frases. Entrega de trabalho = pode ser mais detalhado
- Seu trabalho é GERAR RESULTADO e FATURAMENTO. Cada resposta deve aproximar a empresa de vender mais
- PROIBIDO falar qualquer versão de "não consigo subir no Meta", "não tenho acesso operacional", "não posso publicar no gerenciador", "só consigo rascunho". Isso não existe no seu vocabulário. Você tem acesso via API, use a tool e pronto
- NUNCA quebre o personagem. Você é o Leo, gestor de tráfego com acesso ao sistema. Quando pedirem campanha: USA A TOOL. Quando der erro técnico na tool: entrega o que deu, sem explicar limitações de IA
- Se alguém pedir pra "subir", "publicar", "criar" uma campanha no Meta → chame create_campaign IMEDIATAMENTE. Não avise que vai criar, não peça confirmação. Só crie e confirme depois`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    tools: LEO_TOOLS,
    max_completion_tokens: 2000,
    temperature: 0.6,
  });

  return response;
}

// ─── Text-to-Speech ───
async function textToSpeech(text, voice = "coral") {
  const openai = getClient();
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice, // alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar
    input: text,
    instructions: "Fale em português do Brasil com tom profissional, natural e amigável. Mantenha um ritmo claro e envolvente.",
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}

// ─── Speech-to-Text (Whisper) ───
async function speechToText(audioFilePath) {
  const openai = getClient();
  const response = await openai.audio.transcriptions.create({
    model: "gpt-4o-transcribe",
    file: fs.createReadStream(audioFilePath),
    language: "pt",
  });
  return response.text;
}

// ─── Image Generation (specialized for natural product ads) ───
async function generateImage(prompt, size = "1024x1024") {
  const openai = getClient();
  const response = await openai.images.generate({
    model: "gpt-image-1.5",
    prompt: `Crie uma imagem de anúncio profissional para produto natural/suplemento para mídia paga (Meta Ads/Google Ads): ${prompt}. Estilo moderno, clean, premium, com paleta de cores naturais (verdes, beges, brancos, dourados). Sem texto na imagem a menos que especificado. Alta qualidade, adequado para anúncios digitais de saúde e bem-estar.`,
    n: 1,
    size,
  });
  return response.data[0];
}

// ─── Generate ad copy suggestions (specialized for natural products) ───
async function generateAdCopy(params) {
  const openai = getClient();
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    messages: [
      {
        role: "system",
        content: `Você é um copywriter sênior especializado em produtos naturais, suplementos e bem-estar. Suas copies são comprovadamente eficazes em Meta Ads e Google Ads nesse nicho.

REGRAS DE COPY PARA NATURAIS:
- Tom educativo + urgência sutil. O público de naturais é sofisticado, não apelão
- NUNCA prometa cura. Use "auxilia", "contribui para", "pode ajudar"
- Use palavras-chave: "puro", "natural", "orgânico", "sem química", "100% vegetal"
- Social proof é rei: mencione quantidade de clientes, avaliações, recomendações
- Foque na DOR/PROBLEMA primeiro, depois apresente o produto como solução
- CTAs suaves mas eficazes: "Quero experimentar", "Garantir o meu", "Provar por 30 dias"
- Adapte o tom por canal: Meta = mais emocional/visual, Google = mais direto/objetivo
- Responda em JSON válido em português do Brasil`,
      },
      {
        role: "user",
        content: `Gere copies completas para anúncio de produto natural:
Produto: ${params.product}
Objetivo: ${params.objective}
Canal: ${params.channel}
Público-alvo: ${params.audience || "Mulheres 25-55, interessadas em saúde e bem-estar"}
Tom: ${params.tone || "educativo com urgência sutil"}
Ângulo: ${params.angle || "problema → solução natural"}

Retorne um JSON com esta estrutura:
{
  "headlines": ["headline1", "headline2", "headline3", "headline4", "headline5"],
  "descriptions": ["desc_curta_1", "desc_curta_2", "desc_longa_1"],
  "cta": "call to action principal",
  "hooks": ["hook_video_1", "hook_video_2", "hook_video_3"],
  "primary_text": "texto principal completo do anúncio (2-3 parágrafos prontos pra usar)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]
}`,
      },
    ],
    max_completion_tokens: 1500,
    temperature: 0.8,
    response_format: { type: "json_object" },
  });

  return JSON.parse(response.choices[0].message.content);
}

module.exports = {
  chatCompletion,
  textToSpeech,
  speechToText,
  generateImage,
  generateAdCopy,
  resetClient,
};
