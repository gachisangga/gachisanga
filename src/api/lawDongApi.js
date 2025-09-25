import axios from "axios";
import Config from "react-native-config";


export const getAdmmCdByDong = async (fullDongName) => {
  try {
    const res = await axios.get(
      "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList",
      {
        params: {
          serviceKey: Config.SERVICE_KEY,
          locatadd_nm: fullDongName.split(" ").pop(), // 마지막 동 이름만 검색
          type: "json",
        },
      }
    );

    const rows = res.data?.StanReginCd?.[1]?.row;
    if (!rows || rows.length === 0) {
      console.warn("⚠️ 행정동 코드 찾을 수 없음:", fullDongName);
      return null;
    }

    // ✅ 전체 주소명(locatadd_nm)이 fullDongName과 정확히 일치하는 항목 찾기
    const exact = rows.find((r) => r.locatadd_nm === fullDongName);

    if (!exact) {
      console.warn("⚠️ 정확히 일치하는 항목 없음, 첫 번째 값 사용:", rows[0]);
      return rows[0].region_cd;
    }

    return exact.region_cd;
  } catch (err) {
    console.error("❌ 법정동코드 API 요청 실패:", err.response?.data || err.message);
    return null;
  }
};
