// utils/buildRecommendPayload.js
export function buildRecommendPayload({ kakaoAddr, storesResp, areaCd, topK = 5 }) {
  // 1) 카카오: 좌표/행정동
  const lat = Number(kakaoAddr?.y);
  const lng = Number(kakaoAddr?.x);
  const admmCd = kakaoAddr?.b_code || undefined;                // 법정동코드(10자리)
  const signguNm = kakaoAddr?.region_2depth_name || null;       // 구명(폴백용)

  // 2) 주변 상가 목록 꺼내기 (네 응답 구조에 맞게 안전하게)
  const items = storesResp?.body?.items || storesResp?.items || storesResp || [];

  // 3) 서버가 기대하는 POI 형식으로 매핑(기존 필드 그대로 사용)
  const pois = items.map(it => ({
    lat: Number(it.lat ?? it.y ?? lat),   // 없으면 요청 좌표로 폴백
    lon: Number(it.lon ?? it.x ?? lng),
    indsLclsNm: it.indsLclsNm ?? it.indsMclsNm ?? it.indsSclsNm ?? "기타",
    signguNm: it.signguNm ?? signguNm,
    adongCd: it.adongCd ?? null,
    ldongCd: it.ldongCd ?? null,
  }));

  return { lat, lng, admmCd, areaCd: areaCd || undefined, pois, topK };
}
