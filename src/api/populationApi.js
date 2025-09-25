import axios from "axios";
import Config from "react-native-config";

export const getPopulationByDong = async (admmCd, dongName) => {
  try {
    // 📅 한 달 전 YYYYMM 계산
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    console.log("👉 조회 연월:", ym);

    const res = await axios.get(
      "https://apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn", // ✅ 엔드포인트 확인
      {
        params: {
          serviceKey: Config.SERVICE_KEY,
          admmCd,
          srchFrYm: ym,
          srchToYm: ym,
          lv: 3,
          regSeCd: 1,
          type: "json",
          numOfRows: 100,
          pageNo: 1,
        },
      }
    );

    const items = res.data?.Response?.items?.item || [];
    console.log("📊 전체 인구 데이터 개수:", items.length);

    // ✅ "서창동" 같은 동 이름만 추출
    const filtered = items.find((row) => row.dongNm === dongName);

    if (!filtered) {
      console.warn(`⚠️ '${dongName}' 데이터 없음 → 첫 번째 값 반환`);
      return items[0] || null;
    }

    return filtered;
  } catch (err) {
    console.error("❌ 인구 API 요청 실패:", err.response?.data || err.message);
    return null;
  }
};
