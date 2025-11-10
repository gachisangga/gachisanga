// utils/fetchRecommendations.js
export async function fetchRecommendations(payload) {
  const res = await fetch("http://localhost:3000/api/v1/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
