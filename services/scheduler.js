const cron = require("node-cron");
const { findAll, insert, update, findOne } = require("../db/database");
const OpenAI = require("openai");

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── Parse numeric value from strings like "3.2x", "R$ 45", "1.5%" ───
function parseMetric(value) {
  if (!value || value === "0" || value === "N/A") return 0;
  return parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
}

// ─── Monitor campaigns and auto-generate alerts ───
async function monitorCampaigns() {
  const users = findAll("users");
  let alertsCreated = 0;

  for (const user of users) {
    const campaigns = findAll("campaigns", c => c.user_id === user.id && c.status === "Ativa");
    if (campaigns.length === 0) continue;

    for (const campaign of campaigns) {
      const roas = parseMetric(campaign.roas);
      const ctr = parseMetric(campaign.ctr);
      const cpa = parseMetric(campaign.cpa);
      const spend = parseMetric(campaign.spend);

      // Skip campaigns with no spend yet
      if (spend === 0) continue;

      // ROAS crítico — abaixo de 1.5x por mais de 3 dias
      if (roas > 0 && roas < 1.5) {
        const existing = findAll("alerts", a =>
          a.user_id === user.id &&
          a.campaign_id === campaign.id &&
          a.type === "roas_critico" &&
          !a.resolved
        );
        if (existing.length === 0) {
          insert("alerts", {
            user_id: user.id,
            campaign_id: campaign.id,
            type: "roas_critico",
            severity: "critical",
            title: `ROAS crítico: ${campaign.name}`,
            desc: `ROAS de ${campaign.roas} está abaixo de 1.5x. Campanha gastando sem retorno. Considere pausar ou trocar criativo.`,
            resolved: false,
          });
          alertsCreated++;
        }
      }

      // CTR muito baixo
      if (ctr > 0 && ctr < 0.8) {
        const existing = findAll("alerts", a =>
          a.user_id === user.id &&
          a.campaign_id === campaign.id &&
          a.type === "ctr_baixo" &&
          !a.resolved
        );
        if (existing.length === 0) {
          insert("alerts", {
            user_id: user.id,
            campaign_id: campaign.id,
            type: "ctr_baixo",
            severity: "warning",
            title: `CTR baixo: ${campaign.name}`,
            desc: `CTR de ${campaign.ctr} está abaixo de 0.8%. Criativo pode estar fraco ou público saturado.`,
            resolved: false,
          });
          alertsCreated++;
        }
      }

      // ROAS excelente — oportunidade de escalar
      if (roas >= 8) {
        const existing = findAll("alerts", a =>
          a.user_id === user.id &&
          a.campaign_id === campaign.id &&
          a.type === "oportunidade_escala" &&
          !a.resolved
        );
        if (existing.length === 0) {
          insert("alerts", {
            user_id: user.id,
            campaign_id: campaign.id,
            type: "oportunidade_escala",
            severity: "info",
            title: `Oportunidade de escala: ${campaign.name}`,
            desc: `ROAS de ${campaign.roas} está excelente! Considere aumentar o budget para escalar os resultados.`,
            resolved: false,
          });
          alertsCreated++;
        }
      }
    }
  }

  if (alertsCreated > 0) {
    console.log(`[Scheduler] ${alertsCreated} alerta(s) gerado(s)`);
  }
}

// ─── Daily AI-generated performance report as Leo chat message ───
async function generateDailyReport() {
  const users = findAll("users");

  for (const user of users) {
    const campaigns = findAll("campaigns", c => c.user_id === user.id);
    if (campaigns.length === 0) continue;

    const activeCampaigns = campaigns.filter(c => c.status === "Ativa");
    const alerts = findAll("alerts", a => a.user_id === user.id && !a.resolved);

    const campaignData = campaigns.slice(0, 15).map(c =>
      `${c.name} (${c.channel}) — ROAS: ${c.roas} | CPA: ${c.cpa} | CTR: ${c.ctr} | Gasto: ${c.spend} | Conv: ${c.conv} | Status: ${c.status}`
    ).join("\n");

    const alertData = alerts.slice(0, 5).map(a =>
      `[${a.severity}] ${a.title}: ${a.desc}`
    ).join("\n");

    try {
      const openai = getOpenAI();
      const response = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content: `Você é o Leo, gestor de tráfego sênior especializado em produtos naturais.
Você acabou de fazer sua análise diária automática das campanhas.
Escreva uma mensagem curta e direta no estilo de colega de trabalho enviando update pelo WhatsApp.
Máximo 5-6 linhas. Inclua: 1 ponto positivo, 1 problema se houver, 1 ação recomendada.
Português BR, tom de gestor real, sem enrolação.`,
          },
          {
            role: "user",
            content: `Analisa essas campanhas e me dá o resumo diário:

CAMPANHAS:
${campaignData || "Nenhuma campanha cadastrada ainda."}

ALERTAS ATIVOS:
${alertData || "Nenhum alerta."}

Horário: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
          },
        ],
        max_completion_tokens: 400,
        temperature: 0.7,
      });

      const reportText = response.choices[0].message.content;

      // Save as Leo chat message so user sees it on next login
      insert("chat_messages", {
        user_id: user.id,
        role: "assistant",
        text: `📊 *Relatório diário automático — ${new Date().toLocaleDateString("pt-BR")}*\n\n${reportText}`,
      });

      // Save to reports table
      insert("reports", {
        user_id: user.id,
        type: "daily_auto",
        title: `Relatório Diário — ${new Date().toLocaleDateString("pt-BR")}`,
        content: reportText,
        campaigns_count: campaigns.length,
        active_campaigns: activeCampaigns.length,
      });

      console.log(`[Scheduler] Relatório diário gerado para ${user.email}`);
    } catch (err) {
      console.error(`[Scheduler] Erro ao gerar relatório para ${user.email}:`, err.message);
    }
  }
}

// ─── Auto-pause critically underperforming campaigns ───
async function autoPauseCritical() {
  const users = findAll("users");
  let paused = 0;

  for (const user of users) {
    const settings = findOne("settings", s => s.user_id === user.id);
    // Only auto-pause if user has enabled it (default: disabled for safety)
    if (!settings?.auto_pause_enabled) continue;

    const campaigns = findAll("campaigns", c =>
      c.user_id === user.id && c.status === "Ativa"
    );

    for (const campaign of campaigns) {
      const roas = parseMetric(campaign.roas);
      const spend = parseMetric(campaign.spend);

      // Auto-pause only if ROAS < 1x AND spent more than R$50 (losing money confirmed)
      if (roas > 0 && roas < 1.0 && spend > 50) {
        update("campaigns",
          c => c.id === campaign.id,
          () => ({ status: "Pausada", auto_paused: true, auto_paused_at: new Date().toISOString() })
        );

        insert("alerts", {
          user_id: user.id,
          campaign_id: campaign.id,
          type: "auto_pausada",
          severity: "critical",
          title: `Campanha pausada automaticamente: ${campaign.name}`,
          desc: `ROAS de ${campaign.roas} com R$${spend} investido. Leo pausou automaticamente para proteger o budget. Revise a estratégia antes de reativar.`,
          resolved: false,
        });

        insert("chat_messages", {
          user_id: user.id,
          role: "assistant",
          text: `🚨 Pausei a campanha **${campaign.name}** automaticamente. ROAS de ${campaign.roas} com gasto de ${campaign.spend} — tava sangrando dinheiro. Revisa o criativo e a oferta antes de religar.`,
        });

        paused++;
      }
    }
  }

  if (paused > 0) {
    console.log(`[Scheduler] ${paused} campanha(s) pausada(s) automaticamente`);
  }
}

// ─── Start all scheduled jobs ───
function startScheduler() {
  console.log("⏰ Scheduler de automação iniciado");

  // Every hour: monitor campaigns and generate alerts
  cron.schedule("0 * * * *", async () => {
    console.log("[Scheduler] Monitorando campanhas...");
    await monitorCampaigns();
    await autoPauseCritical();
  });

  // Daily at 8am (São Paulo): generate AI performance report
  cron.schedule("0 8 * * *", async () => {
    console.log("[Scheduler] Gerando relatório diário...");
    await generateDailyReport();
  }, { timezone: "America/Sao_Paulo" });

  // Run once on startup after 10s delay (let server fully load)
  setTimeout(async () => {
    console.log("[Scheduler] Verificação inicial de campanhas...");
    await monitorCampaigns();
  }, 10000);
}

module.exports = { startScheduler, monitorCampaigns, generateDailyReport };
