// Google Analytics Data API (GA4)
const { getValidToken } = require("./google-auth");

async function fetchAnalyticsOverview(userId, propertyId) {
  const token = await getValidToken(userId, "google");
  if (!token || !propertyId) return null;

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        metrics: [
          { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
          { name: "bounceRate" }, { name: "averageSessionDuration" },
          { name: "screenPageViews" }, { name: "conversions" }, { name: "totalRevenue" },
        ],
      }),
    }
  );

  if (!res.ok) {
    console.error("GA4 API error:", await res.text());
    return null;
  }

  const data = await res.json();
  const row = data.rows?.[0]?.metricValues || [];
  return {
    sessions: parseInt(row[0]?.value || 0),
    users: parseInt(row[1]?.value || 0),
    newUsers: parseInt(row[2]?.value || 0),
    bounceRate: parseFloat(row[3]?.value || 0),
    avgDuration: parseFloat(row[4]?.value || 0),
    pageViews: parseInt(row[5]?.value || 0),
    conversions: parseInt(row[6]?.value || 0),
    revenue: parseFloat(row[7]?.value || 0),
  };
}

async function fetchTrafficSources(userId, propertyId) {
  const token = await getValidToken(userId, "google");
  if (!token || !propertyId) return [];

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return (data.rows || []).map(r => ({
    channel: r.dimensionValues[0]?.value,
    sessions: parseInt(r.metricValues[0]?.value || 0),
    conversions: parseInt(r.metricValues[1]?.value || 0),
    revenue: parseFloat(r.metricValues[2]?.value || 0),
  }));
}

module.exports = { fetchAnalyticsOverview, fetchTrafficSources };
