import axios from "axios";
import Config from "react-native-config"; 

// 카카오 주소 → 좌표 변환 함수
export const getCoordsByAddress = async (address) => {
  try {
    const res = await axios.get(
      "https://dapi.kakao.com/v2/local/search/address.json",
      {
        params: { query: address },
        headers: {
          Authorization: `KakaoAK ${Config.KAKAO_REST_KEY}`,
        },
      }
    );

    console.log("카카오 API 응답:", res.data);
    console.log("Config 전체:", Config);
    console.log("헤더 Authorization:", `KakaoAK ${Config.KAKAO_REST_KEY}`);

    res.data.documents.forEach((doc, i) => {
      console.log(`[${i}] 주소정보:`, doc.address || doc.road_address);
    });

    if (res.data.documents.length > 0) {
      const { x, y, address: addr, road_address } = res.data.documents[0];

      // address가 없을 수도 있으므로 fallback 처리
      const baseAddr = addr || road_address;
      if (!baseAddr) {
        console.warn("주소 정보 없음:", res.data.documents[0]);
        return {
          latitude: parseFloat(y),
          longitude: parseFloat(x),
          fullDongName: null,
        };
      }

      const { region_1depth_name, region_2depth_name, region_3depth_name } = baseAddr;

      return {
        latitude: parseFloat(y),
        longitude: parseFloat(x),
        fullDongName: `${region_1depth_name} ${region_2depth_name} ${region_3depth_name}`, 
      };
    } else {
      console.warn("검색 결과 없음:", address);
      return null;
    }
  } catch (err) {
    console.error("카카오 API 요청 실패:", err.response?.data || err.message);
    return null;
  }
};
