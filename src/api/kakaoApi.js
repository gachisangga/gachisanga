import axios from "axios";
import Config from "react-native-config"; 

// ✅ 카카오 주소 → 좌표 변환 함수
export const getCoordsByAddress = async (address) => {
  try {
    const res = await axios.get(
      "https://dapi.kakao.com/v2/local/search/address.json",
      {
        params: { query: address },
        headers: {
          Authorization: `KakaoAK ${Config.KAKAO_REST_KEY}`, // ✅ 변수 이름 통일
          
        },
      }
    );

    console.log("📌 카카오 API 응답:", res.data);
    console.log("👉 Config 전체:", Config);
    console.log("👉 헤더 Authorization:", `KakaoAK ${Config.KAKAO_REST_KEY}`);

    if (res.data.documents.length > 0) {
      const { x, y } = res.data.documents[0];
      return {
        latitude: parseFloat(y),
        longitude: parseFloat(x),
      };
    } else {
      console.warn("⚠️ 검색 결과 없음:", address);
      return null;
    }
  } catch (err) {
    console.error("❌ 카카오 API 요청 실패:", err.response?.data || err.message);
    return null;
  }
};
