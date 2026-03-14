const express = require("express");
const { findAll } = require("../db/database");

const router = express.Router();

router.get("/", (req, res) => {
  const connections = findAll("connections", r => r.user_id === req.userId && r.connected === true);
  const hasGoogle = connections.some(c => c.platform === "google");
  const hasMeta = connections.some(c => c.platform === "meta");
  const campaigns = findAll("campaigns", r => r.user_id === req.userId);

  // If no platforms connected, return empty dashboard
  if (!hasGoogle && !hasMeta) {
    return res.json({
      kpis: [
        { label: "Investimento Total", value: "R$ 0", change: 0 },
        { label: "ROAS Médio", value: "0.0x", change: 0 },
        { label: "CPA Médio", value: "R$ 0,00", change: 0 },
        { label: "CTR Médio", value: "0.0%", change: 0 },
        { label: "Conversões", value: "0", change: 0 },
        { label: "Campanhas Ativas", value: "0", change: 0 },
        { label: "Leads", value: "0", change: 0 },
        { label: "Receita Est.", value: "R$ 0", change: 0 },
      ],
      chartData: [],
      pieData: [],
      insights: [{ type: "info", text: "Conecte Google Ads ou Meta Ads na página de Integrações para começar a ver dados reais.", priority: "Alta" }],
      funnelData: [],
      connected: false,
    });
  }

  // If connected but no campaigns yet, return zeros with info
  if (campaigns.length === 0) {
    return res.json({
      kpis: [
        { label: "Investimento Total", value: "R$ 0", change: 0 },
        { label: "ROAS Médio", value: "0.0x", change: 0 },
        { label: "CPA Médio", value: "R$ 0,00", change: 0 },
        { label: "CTR Médio", value: "0.0%", change: 0 },
        { label: "Conversões", value: "0", change: 0 },
        { label: "Campanhas Ativas", value: "0", change: 0 },
        { label: "Leads", value: "0", change: 0 },
        { label: "Receita Est.", value: "R$ 0", change: 0 },
      ],
      chartData: [],
      pieData: [],
      insights: [{ type: "info", text: "Plataformas conectadas, mas ainda sem dados de campanhas. Os dados aparecerão quando a sincronização com as contas de anúncio for concluída via OAuth.", priority: "Alta" }],
      funnelData: [],
      connected: true,
    });
  }

  const parseMoney = (str) => {
    if (!str) return 0;
    return parseFloat(str.replace(/[^0-9,.-]/g, "").replace(".", "").replace(",", ".")) || 0;
  };

  const totalSpend = campaigns.reduce((s, c) => s + parseMoney(c.spend), 0);
  const totalConv = campaigns.reduce((s, c) => s + (c.conv || 0), 0);
  const avgCPA = totalConv > 0 ? totalSpend / totalConv : 0;
  const avgROAS = campaigns.length > 0
    ? campaigns.reduce((s, c) => s + (parseFloat(c.roas) || 0), 0) / campaigns.length
    : 0;
  const avgCTR = campaigns.length > 0
    ? campaigns.reduce((s, c) => s + (parseFloat(c.ctr) || 0), 0) / campaigns.length
    : 0;
  const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const totalClicks = totalImpressions > 0 ? Math.round(totalImpressions * avgCTR / 100) : 0;

  const googleCampaigns = campaigns.filter(c => c.channel === "Google");
  const metaCampaigns = campaigns.filter(c => c.channel === "Meta");
  const googleSpend = googleCampaigns.reduce((s, c) => s + parseMoney(c.spend), 0);
  const metaSpend = metaCampaigns.reduce((s, c) => s + parseMoney(c.spend), 0);

  const activeCampaigns = campaigns.filter(c => c.status === "Ativa" || c.status === "Escalando").length;

  const kpis = [
    { label: "Investimento Total", value: `R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`, change: 0 },
    { label: "ROAS Médio", value: `${avgROAS.toFixed(1)}x`, change: 0 },
    { label: "CPA Médio", value: `R$ ${avgCPA.toFixed(2)}`, change: 0 },
    { label: "CTR Médio", value: `${avgCTR.toFixed(1)}%`, change: 0 },
    { label: "Conversões", value: totalConv.toString(), change: 0 },
    { label: "Campanhas Ativas", value: activeCampaigns.toString(), change: 0 },
    { label: "Impressões", value: totalImpressions.toLocaleString("pt-BR"), change: 0 },
    { label: "Receita Est.", value: `R$ ${Math.round(totalSpend * avgROAS).toLocaleString("pt-BR")}`, change: 0 },
  ];

  // Pie data — real distribution
  const pieData = [];
  if (googleSpend > 0) pieData.push({ name: "Google Ads", value: Math.round(googleSpend), color: "#6366f1" });
  if (metaSpend > 0) pieData.push({ name: "Meta Ads", value: Math.round(metaSpend), color: "#22d3ee" });

  // Insights based on real data
  const insights = [];
  if (avgROAS > 3) {
    insights.push({ type: "success", text: `Seu ROAS médio de ${avgROAS.toFixed(1)}x está acima da meta. Continue escalando as campanhas com melhor performance.`, priority: "Alta" });
  } else if (avgROAS > 0 && avgROAS < 2) {
    insights.push({ type: "warning", text: `ROAS médio de ${avgROAS.toFixed(1)}x está abaixo do ideal. Revise segmentação e criativos.`, priority: "Alta" });
  }
  const highCPA = campaigns.filter(c => parseMoney(c.cpa) > avgCPA * 1.3);
  if (highCPA.length > 0) {
    insights.push({ type: "warning", text: `${highCPA.length} campanha(s) com CPA acima da média. Considere otimizar segmentação e criativos.`, priority: "Alta" });
  }
  const scaling = campaigns.filter(c => c.status === "Escalando");
  if (scaling.length > 0) {
    insights.push({ type: "opportunity", text: `${scaling.length} campanha(s) em fase de escala com bom ROAS. Oportunidade de aumentar orçamento.`, priority: "Média" });
  }
  if (totalSpend > 0) {
    insights.push({ type: "info", text: `Distribuição de verba: Google Ads ${((googleSpend / totalSpend) * 100).toFixed(0)}% | Meta Ads ${((metaSpend / totalSpend) * 100).toFixed(0)}%`, priority: "Baixa" });
  }

  // Funnel data — derived from real campaign metrics
  const funnelData = totalImpressions > 0 ? [
    { stage: "Impressões", rate: "100%", google: googleCampaigns.reduce((s, c) => s + (c.impressions || 0), 0), meta: metaCampaigns.reduce((s, c) => s + (c.impressions || 0), 0) },
    { stage: "Cliques", rate: `${avgCTR.toFixed(1)}%`, google: Math.round(googleCampaigns.reduce((s, c) => s + (c.impressions || 0), 0) * avgCTR / 100), meta: Math.round(metaCampaigns.reduce((s, c) => s + (c.impressions || 0), 0) * avgCTR / 100) },
    { stage: "Conversões", rate: totalClicks > 0 ? `${(totalConv / totalClicks * 100).toFixed(1)}%` : "0%", google: googleCampaigns.reduce((s, c) => s + (c.conv || 0), 0), meta: metaCampaigns.reduce((s, c) => s + (c.conv || 0), 0) },
  ] : [];

  res.json({ kpis, chartData: [], pieData, insights, funnelData, connected: true });
});

module.exports = router;
