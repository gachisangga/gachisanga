import axios from "axios";
import Config from "react-native-config";

const STORE_API_URL =
  "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius";

// 반경 내 상가 조회
export const getStoresInRadius = async ({ latitude, longitude, radius = 500 }) => {
  try {
    const res = await axios.get(STORE_API_URL, {
      params: {
        ServiceKey: Config.SERVICE_KEY, // .env에 넣어둔 값
        pageNo: 1,
        numOfRows: 500,
        radius: radius, // 500m
        cx: longitude,  // 경도
        cy: latitude,   // 위도
        type: "json",
      },
    });

    console.log("상가 조회 응답:", res.data);
    return res.data.body?.items || [];
  } catch (err) {
    console.error("상가 조회 실패:", err.response?.data || err.message);
    return [];
  }
};
