// src/screens/MapScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  Keyboard,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getCoordsByAddress } from "../api/kakaoApi";
import { getStoresInRadius } from "../api/StoresInRadius";
import { getAdmmCdByDong } from "../api/lawDongApi";
import { getPopulationByDong } from "../api/populationApi";

// 유틸
import { buildRecommendPayload } from "../utils/buildRecommendPayload";
import { fetchRecommendations } from "../utils/fetchRecommendations";

/** ----------------------------------------------------------------------------
 * 서버 API 베이스 URL
 * ---------------------------------------------------------------------------*/
const RECO_API_BASE = "http://localhost:3000/api/v1";

/** ----------------------------------------------------------------------------
 * 카테고리 정책(프론트에서 필터링)
 * ---------------------------------------------------------------------------*/
const CATEGORY_META = {
  "카페/디저트": { openable: true, needsLicense: false, franchiseable: true },
  분식: { openable: true, needsLicense: false, franchiseable: true },
  패스트푸드: { openable: true, needsLicense: false, franchiseable: true },
  편의점: { openable: true, needsLicense: false, franchiseable: true },
  "뷰티/미용": {
    openable: true,
    needsLicense: true,
    franchiseable: true,
  },
  한식: { openable: true, needsLicense: false, franchiseable: true },

  // 전문/허가 필요
  보건의료: { openable: false, needsLicense: true, franchiseable: false },
  교육: { openable: false, needsLicense: true, franchiseable: true },
  부동산: { openable: false, needsLicense: true, franchiseable: false },
  숙박: { openable: false, needsLicense: true, franchiseable: true },

  // 기타
  "예술·스포츠": { openable: true, needsLicense: false, franchiseable: true },
  소매: { openable: true, needsLicense: false, franchiseable: true },
  음식: { openable: true, needsLicense: false, franchiseable: true },
};
const getMeta = (cat) =>
  CATEGORY_META[cat] ?? {
    openable: true,
    needsLicense: false,
    franchiseable: false,
  };

const MapScreen = () => {
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  // 🔹 주변 상가(POI) 그대로 저장 → 프랜차이즈 추천에 사용
  const [storePois, setStorePois] = useState([]);

  // 전체 응답 저장 (topCategories + why + debug)
  const [recoData, setRecoData] = useState(null);

  // 🔹 브랜드별 추천 결과 캐시 (brandNm → 추천 결과)
  const [brandRecoCache, setBrandRecoCache] = useState({});

    // UX
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);

  // 🔹 추천 전략: "trend"(인기/트렌드) | "gap"(틈새/공백)
  const [strategy, setStrategy] = useState("gap");

  // 탭(일반/허가) 스위치
  const [activeTab, setActiveTab] = useState("openable"); // "openable" | "licensed"


  // 사용자 분류 선택 (대/중분류)
  const [selectedL, setSelectedL] = useState(null); // 대분류
  const [selectedM, setSelectedM] = useState(null); // 중분류

  // 대분류 선호도 (관심있음 / 없음)
  const [interestedL, setInterestedL] = useState([]); // string[]
  const [blockedL, setBlockedL] = useState([]); // string[]

  // 검색 / 고급 필터 (C 시나리오용)
  const [searchQuery, setSearchQuery] = useState("");
  const [densityFilter, setDensityFilter] = useState("all"); // all | many | few
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  // A 시나리오용 프랜차이즈 검색 상태
  const [brandSearchQueryA, setBrandSearchQueryA] = useState("");
  const [selectedBrandA, setSelectedBrandA] = useState(null);

  // 프랜차이즈
  const [brandList, setBrandList] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandErr, setBrandErr] = useState(null);

  // C 시나리오 내부 단계: idle | summary | category | result
  const [step, setStep] = useState("idle");
  const [selectedCategory, setSelectedCategory] = useState(null);

  // 상권 정보 모달 (오버레이)
  const [poiModalVisible, setPoiModalVisible] = useState(false);
  const [poiModalType, setPoiModalType] = useState("many"); // "many" | "few"

  // 프랜차이즈 상세 모달 (C/B 시나리오 등에서 사용, 오버레이)
  const [brandModalVisible, setBrandModalVisible] = useState(false);
  const [selectedBrandDetail, setSelectedBrandDetail] = useState(null);

  // 👉 추천 패널 표시 여부
  const [panelVisible, setPanelVisible] = useState(false);

  // 🔹 앱 전체 단계 + 시나리오 (A/B/C)
  const [appStep, setAppStep] = useState("location"); // "location" | "scenario" | "flow"
  const [scenario, setScenario] = useState(null); // "A" | "B" | "C" | null


  
    // 🔹 특정 브랜드에 대한 추천 점수/이유를 백엔드에서 가져오는 헬퍼
  const loadBrandReco = async (brand) => {
     console.log("[loadBrandReco] called for", brand?.brandNm);
  try {
    // 기본 정보 없으면 스킵
    if (!brand?.indutyLclasNm || !brand?.indutyMlsfcNm) return;
    if (!coords || !storePois.length || !recoData) return;

    const cacheKey = brand.brandNm;
    // 이미 캐시에 있으면 바로 merge만
    if (brandRecoCache[cacheKey]) {
      setSelectedBrandDetail((prev) =>
        prev && prev.brandNm === brand.brandNm
          ? { ...prev, ...brandRecoCache[cacheKey] }
          : prev
      );
      return;
    }

    setBrandLoading(true);

    const inputs = recoData?.debug?.inputs || {};
    const fv = recoData?.debug?.featureVector || {};

    // 🔹 여기서 브랜드 추천용 body를 한 번만 깔끔하게 만든다
    // 예: 추천 기준 (인기 / 틈새) + 업종 분포 필터 상태가 있다고 치고
// recommendBasis: "popular" | "niche"
// densityFilter: "all" | "many" | "few"

const body = {
  lat: coords.latitude,
  lng: coords.longitude,
  l: brand.indutyLclasNm,
  m: brand.indutyMlsfcNm,
  radius: fv.radius || 300,
  pois: storePois,
  topK: 20,
  year: "2024",

  // 🔹 추천 기준 (인기 / 틈새)
  recommendBasis,    // or strategy 같은 이름으로 통일해도 됨

  // 🔹 업종 분포 필터 (많이 / 거의 없음)
  densityFilter,     // "all" | "many" | "few"
};


    // admmCd / areaCd는 값 있을 때만 붙이기
    if (inputs.admmCd) {
      body.admmCd = inputs.admmCd;
    }
    if (inputs.resolvedAreaCd || inputs.areaCdFromClient) {
      body.areaCd = inputs.resolvedAreaCd || inputs.areaCdFromClient;
    }

    // 🔹 body 그대로 사용
    const res = await fetch(`${RECO_API_BASE}/brands/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    const matched =
      (json.brands || []).find((b) => b.brandNm === brand.brandNm) || null;

    if (matched) {
      // 캐시에 저장
      setBrandRecoCache((prev) => ({
        ...prev,
        [cacheKey]: matched,
      }));

      // 현재 선택된 상세에 merge
      setSelectedBrandDetail((prev) =>
        prev && prev.brandNm === brand.brandNm
          ? { ...prev, ...matched }
          : prev
      );

      // A 시나리오에서 선택된 브랜드도 업데이트
      setSelectedBrandA((prev) =>
        prev && prev.brandNm === brand.brandNm
          ? { ...prev, ...matched }
          : prev
      );
    }
  } catch (e) {
    console.log("브랜드 추천 점수/이유 조회 실패:", e);
  } finally {
    setBrandLoading(false);
  }
};


  // 🔹 프랜차이즈 모달 열기/닫기 헬퍼
  const openBrandModal = (brand) => {
    setSelectedBrandDetail(brand);
    setBrandModalVisible(true);
    // 백엔드에서 추천 이유 가져오기
    loadBrandReco(brand);
  };

  const closeBrandModal = () => {
    setBrandModalVisible(false);
    setSelectedBrandDetail(null);
  };


  // 🔹 추천 전략만 바꿔서 다시 카테고리 추천을 불러오는 헬퍼
const refetchWithStrategy = async (nextStrategy) => {
  // 좌표/상가/기존 추천 없으면 그냥 무시
  if (!coords || !storePois.length || !recoData) return;

  try {
    setLoading(true);
    setErrMsg(null);

    const inputs = recoData?.debug?.inputs || {};
    const fullDongName = inputs.fullDongName;

    const kakaoAddrObj = {
      x: String(coords.longitude),
      y: String(coords.latitude),
      b_code: undefined,
      region_2depth_name: pickGuFromFull(fullDongName),
    };

    let payload = buildRecommendPayload({
      kakaoAddr: kakaoAddrObj,
      storesResp: storePois,
      areaCd: undefined,
      topK: 10,
    });

    // 사용자가 대/중분류 선택해둔 게 있으면 같이 전달
    let targetCate = null;
    if (selectedM) {
      targetCate = { level: "M", name: selectedM };
    } else if (selectedL) {
      targetCate = { level: "L", name: selectedL };
    }
    if (targetCate) {
      payload = { ...payload, targetCate };
    }

    // 🔹 전략 반영 (trend | gap)
    payload = { ...payload, strategy: nextStrategy };

    console.time("추천 API (strategy 변경)");
    let rec;
    try {
      rec = await fetchRecommendations(payload);
    } finally {
      console.timeEnd("추천 API (strategy 변경)");
    }

    setRecoData(rec);
  } catch (e) {
    console.warn("전략 변경 후 추천 실패:", e);
    setErrMsg(e?.message || "추천을 다시 불러오지 못했습니다.");
  } finally {
    setLoading(false);
  }
};


  const handleSearch = async () => {
  if (!address.trim() || loading) return;
  setErrMsg(null);
  setLoading(true);
  setStep("idle");
  setSelectedCategory(null);
  setAppStep("location");
  setScenario(null);
  setSelectedBrandA(null);
  setBrandSearchQueryA("");
  setPanelVisible(true); // 검색 시작 시 패널 열기
  Keyboard.dismiss();

  try {
    // 1) 주소 → 좌표
    const result = await getCoordsByAddress(address);
    console.log("검색 결과:", result);
    if (!result) {
      setErrMsg("주소를 찾지 못했습니다.");
      setLoading(false);
      return;
    }
    setCoords(result);

    // 2) 반경 내 상가 조회
    const stores = await getStoresInRadius(result);
    console.log("주변 상가 리스트:", stores);
    setStorePois(stores);   // ✅ 프랜차이즈 추천용으로 state에 저장


    // 3) 주소명 → 행정동 코드
    const { fullDongName } = result;
    console.log("카카오에서 받은 fullDongName:", fullDongName);
    const admmCd = await getAdmmCdByDong(fullDongName);
    console.log("변환된 admmCd:", admmCd);

    // (선택) 인구 API 조회 – 백엔드가 자체 조회하므로 없어도 동작
    if (admmCd) {
      const parts = (fullDongName || "").split(" ").filter(Boolean);
      const dongName = parts.length ? parts[parts.length - 1] : undefined;
      const population = await getPopulationByDong(admmCd, dongName);
      console.log("인구 데이터(프론트):", population);
    }

    // 4) 추천 API 호출
    const kakaoAddrObj = {
      x: String(result.longitude),
      y: String(result.latitude),
      b_code: undefined,
      region_2depth_name: pickGuFromFull(fullDongName),
    };

        let payload = buildRecommendPayload({
      kakaoAddr: kakaoAddrObj,
      storesResp: stores,
      areaCd: undefined,
      topK: 10,
    });

    // 🔹 추천 전략 추가 (trend | gap) - 백엔드 ReqSchema에 맞춰 전달
    payload = { ...payload, strategy };

    let targetCate = null;

    if (selectedM) {
      targetCate = { level: "M", name: selectedM };
    } else if (selectedL) {
      targetCate = { level: "L", name: selectedL };
    }
    if (targetCate) {
      payload = { ...payload, targetCate };
    }

    // 🔍 디버깅용: 최종 payload 확인
    console.log("추천 API payload:", JSON.stringify(payload, null, 2));

    // ⏱ 추천 API 호출 시간 측정
    console.time("추천 API");
    let rec;
    try {
      rec = await fetchRecommendations(payload);
    } finally {
      // ✅ 성공/실패 상관없이 항상 타이머 종료
      console.timeEnd("추천 API");
    }

    console.log("추천 결과 원본:", JSON.stringify(rec, null, 2));
    console.log(
      "areaSummary.population.ageBands =",
      JSON.stringify(rec?.debug?.areaSummary?.population?.ageBands, null, 2)
    );

    setRecoData(rec);
    setStep("summary"); // 기본 요약
    setAppStep("scenario"); // 위치 분석 후 → 시나리오 선택
  } catch (e) {
    // 🔍 에러 상세 로그
    console.warn("추천 호출 실패 전체 error:", e);
    console.warn("추천 호출 실패 name/message:", e?.name, e?.message);
    if (e?.stack) {
      console.warn("추천 호출 실패 stack:", e.stack);
    }

    setErrMsg(e?.message || "요청 중 오류가 발생했습니다.");
    setRecoData(null);
    setStep("idle");
    setAppStep("location");
    setScenario(null);
  } finally {
    setLoading(false);
  }
};



  // Why 라인/상세
  // Why 라인/상세
    const whyLine =
    recoData?.why?.line ?? buildWhyFallback(recoData) ?? null;
  const d =
    recoData?.why?.details ?? buildDetailsFallback(recoData) ?? null;


// 🔹 백엔드에서 계산한 상권/상가 요약
// 1순위: 최상위(areaSummary), 2순위: 예전 형식(debug.areaSummary)도 대비
const areaSummary =
  recoData?.areaSummary || recoData?.debug?.areaSummary || null;
const storeSummary =
  recoData?.storeSummary || recoData?.debug?.storeSummary || null;



  // Top-K (항상 소분류 기준)
  const top = Array.isArray(recoData?.topCategories)
    ? recoData.topCategories
    : [];

  // taxonomy
  const taxonomy = recoData?.debug?.taxonomy || {};
  const lOptions = taxonomy.L || [];
  const MByL = taxonomy.MByL || {};
  const SByM = taxonomy.SByM || {};

  // 선택된 대분류에 맞는 중분류
  const mOptions =
    selectedL && MByL[selectedL] ? MByL[selectedL] : [];

  // 소분류 -> 중분류 찾기
  function findMByS(sName) {
    for (const [m, sList] of Object.entries(SByM)) {
      if (Array.isArray(sList) && sList.includes(sName)) {
        return m;
      }
    }
    return null;
  }

  // 중분류 -> 대분류 찾기
  function findLByM(mName) {
    for (const [l, mList] of Object.entries(MByL)) {
      if (Array.isArray(mList) && mList.includes(mName)) {
        return l;
      }
    }
    return null;
  }

  // 대분류 선호도 필터
  function allowedByInterest(lName) {
    if (!lName) return true;
    if (blockedL.includes(lName)) return false;
    if (interestedL.length > 0 && !interestedL.includes(lName))
      return false;
    return true;
  }

  // 대분류 관심/비관심 토글 (길게 누르기)
  const handleToggleInterestL = (l) => {
    const isLiked = interestedL.includes(l);
    const isBlocked = blockedL.includes(l);

    if (!isLiked && !isBlocked) {
      // 기본 -> 관심있음
      setInterestedL([...interestedL, l]);
    } else if (isLiked) {
      // 관심있음 -> 관심없음
      setInterestedL(interestedL.filter((x) => x !== l));
      setBlockedL([...blockedL, l]);
    } else if (isBlocked) {
      // 관심없음 -> 기본
      setBlockedL(blockedL.filter((x) => x !== l));
    }
  };

  // 대분류/중분류 선택 핸들러
  const handleSelectL = (l) => {
    const next = selectedL === l ? null : l;
    setSelectedL(next);
    setSelectedM(null);
    setSelectedBrandA(null);
  };
  const handleSelectM = (m) => {
    const next = selectedM === m ? null : m;
    setSelectedM(next);
    setSelectedBrandA(null);
  };

  // 소분류가 선택한 L/M 아래에 있는지 체크
  function belongsToSelectedBranch(sName) {
    const hasHierarchy =
      Object.keys(MByL).length > 0 && Object.keys(SByM).length > 0;
    if (!hasHierarchy) {
      return true;
    }

    const mName = findMByS(sName);
    if (!mName) {
      if (!selectedL && !selectedM) return true;
      return false;
    }

    const lName = findLByM(mName);

    if (selectedL && lName && lName !== selectedL) return false;
    if (selectedM && mName !== selectedM) return false;

    return true;
  }

    // 🔹 성별 라벨: areaSummary에 있으면 그거, 없으면 d.demographics에서 계산
  const genderLabel =
    areaSummary?.population?.genderLabel ??
    (() => {
      const femaleVal = d?.demographics?.female?.value;
      if (femaleVal == null) return null;
      const maleVal = 1 - femaleVal;
      return `여성 ${(femaleVal * 100).toFixed(1)}%, 남성 ${(maleVal * 100).toFixed(1)}%`;
    })();


  // 업종 분포 상위/하위 (details에서 가져옴)
  const manyCateSet = React.useMemo(
    () => new Set(d?.poi?.topMost?.map((x) => x.category) || []),
    [d]
  );
  const fewCateSet = React.useMemo(
    () =>
      new Set(d?.poi?.leastCommon?.map((x) => x.category) || []),
    [d]
  );

  // 🔹 소분류 추천 필터 (C 시나리오)
  const filteredTop = top.filter((item) => {
    const sName = item.category;

    // ① 대분류/중분류 드릴다운 가지 안에 속하는지
    if (!belongsToSelectedBranch(sName)) {
      return false;
    }

    // ② 대분류 선호도(관심있음/없음) 필터
    const mName = findMByS(sName);
    const lName = mName ? findLByM(mName) : null;
    if (lName && !allowedByInterest(lName)) {
      return false;
    }

    // ③ 업종 분포 필터 (많은 업종 / 적은 업종)
    if (densityFilter === "many" && !manyCateSet.has(sName)) {
      return false;
    }
    if (densityFilter === "few" && !fewCateSet.has(sName)) {
      return false;
    }

    // ④ 검색 필터 (소분류명 기준)
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      if (!sName.includes(q)) {
        return false;
      }
    }

    return true;
  });

  // 🔹 필터 결과가 비면 전체 top으로 fallback
  const effectiveTop = filteredTop.length > 0 ? filteredTop : top;

  // 🔹 일반/허가 분리 + 5개로 고정
  const { openableList, licensedList } =
    partitionCategories(effectiveTop);
  const openable5 = fillToFive(openableList, licensedList);
  const licensed5 = fillToFive(licensedList, openableList);

  // 🔹 중분류 추천 (선택된 대분류 안에서, 소분류 점수 합산)
  const midScores = {};
  for (const item of top) {
    const sName = item.category;
    const score =
      typeof item.score === "number" ? item.score : 0;

    const mName = findMByS(sName);
    if (!mName) continue;

    const lName = findLByM(mName);
    if (lName && !allowedByInterest(lName)) continue;

    // 선택된 대분류가 있으면, 그 L 아래에 있는 M만 인정
    if (selectedL && lName && lName !== selectedL) continue;

    midScores[mName] = (midScores[mName] || 0) + score;
  }

  const midList = Object.entries(midScores)
    .map(([m, score]) => ({ m, score }))
    .sort((a, b) => b.score - a.score);
  const midTop5 = midList.slice(0, 5);

  const renderMidList = (items = []) =>
    items.map((it) => (
      <TouchableOpacity
        key={it.m}
        onPress={() => {
          setSelectedM(it.m);
        }}
      >
        <Text style={styles.recoItem}>
          • {it.m}
          <Text style={styles.recoScore}>
            {" "}
            {typeof it.score === "number"
              ? it.score.toFixed(3)
              : String(it.score)}
          </Text>
        </Text>
      </TouchableOpacity>
    ));

  /** 🔹 프랜차이즈 목록: L/M에 맞는 것만 추천에 사용 */
  /** 🔹 프랜차이즈 목록: 이 상권 + 선택한 L/M 기준 추천 */
useEffect(() => {
  // 중분류/좌표/상가/추천결과가 준비 안 됐으면 비우고 종료
  if (!selectedM || !coords || !storePois.length || !recoData) {
    setBrandList([]);
    setBrandErr(null);
    return;
  }

  const fetchBrands = async () => {
    try {
      setBrandLoading(true);
      setBrandErr(null);

      const inputs = recoData?.debug?.inputs || {};
      const fv = recoData?.debug?.featureVector || {};

      const body = {
        lat: coords.latitude,
        lng: coords.longitude,
        l: selectedL || "음식",   // 대분류 없으면 임시 기본값
        m: selectedM,             // 선택한 중분류 (예: "한식")
        radius: fv.radius || 300,
        pois: storePois,          // 주변 상가 500개 (bizesNm 포함)
        topK: 20,
        year: "2024",
      };

      // admmCd / areaCd는 값 있을 때만 붙이기
      if (inputs.admmCd) {
        body.admmCd = inputs.admmCd;
      }
      if (inputs.resolvedAreaCd || inputs.areaCdFromClient) {
        body.areaCd = inputs.resolvedAreaCd || inputs.areaCdFromClient;
      }

      console.log("[BrandReco] request body:", body);

      const res = await fetch(`${RECO_API_BASE}/brands/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = await res.json();
      console.log("[BrandReco] response:", json);

      // 이 상권 기준으로 추천된 프랜차이즈 리스트
      setBrandList(json.brands || []);
    } catch (e) {
      console.log("브랜드 추천 목록 조회 실패:", e);
      setBrandErr("프랜차이즈 정보를 불러오지 못했어요.");
      setBrandList([]);
    } finally {
      setBrandLoading(false);
    }
  };

  fetchBrands();
}, [selectedL, selectedM, coords, storePois, recoData]);


  // 🔹 선택한 L/M + taxonomy 기준으로 프랜차이즈 필터
  const filteredBrandList = brandList.filter((b) => {
    // 1) 선택한 대분류 기준으로 taxonomy 가지 안에 있는 프랜차이즈만 허용
    if (selectedL) {
      const mListForSelectedL = MByL[selectedL];

      if (Array.isArray(mListForSelectedL) && b.indutyMlsfcNm) {
        if (!mListForSelectedL.includes(b.indutyMlsfcNm)) {
          return false;
        }
      } else {
        if (b.indutyLclasNm !== selectedL) return false;
      }
    }

    // 2) 선택한 중분류와 다른 프랜차이즈는 제외
    if (selectedM && b.indutyMlsfcNm !== selectedM) return false;

    // 3) 대분류 선호도(관심/비관심) 필터
    const lName = b.indutyLclasNm;
    if (lName && !allowedByInterest(lName)) return false;

    return true;
  });

  const shownBrandList =
    selectedL || selectedM ? filteredBrandList : brandList;

  // C 시나리오용: 검색 적용된 프랜차이즈 리스트
  const searchedBrandList = React.useMemo(() => {
    if (!searchQuery.trim()) return shownBrandList;
    const q = searchQuery.trim();
    return shownBrandList.filter(
      (b) =>
        b.brandNm?.includes(q) ||
        b.indutyMlsfcNm?.includes(q) ||
        b.indutyLclasNm?.includes(q)
    );
  }, [shownBrandList, searchQuery]);

  // A 시나리오용: 프랜차이즈 검색 결과
  const searchedBrandListA = React.useMemo(() => {
    if (!brandSearchQueryA.trim()) return shownBrandList;
    const q = brandSearchQueryA.trim();
    return shownBrandList.filter(
      (b) =>
        b.brandNm?.includes(q) ||
        b.indutyMlsfcNm?.includes(q) ||
        b.indutyLclasNm?.includes(q)
    );
  }, [shownBrandList, brandSearchQueryA]);

  // B 시나리오용: 선택된 중분류에 해당하는 프랜차이즈만
  const brandListForB = selectedM ? filteredBrandList : [];

  const hasReco = !!recoData;

  // 지도 영역
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : {
        latitude: 37.5665,
        longitude: 126.978,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };

  return (
    <View style={{ flex: 1 }}>
      {/* 지도 */}
      <MapView style={{ flex: 1 }} region={region}>
        {coords && (
          <Marker
            coordinate={{
              latitude: coords.latitude,
              longitude: coords.longitude,
            }}
          />
        )}
      </MapView>

      {/* 결과 패널 */}
      {(loading || panelVisible) && (
        <View style={styles.recoContainer}>
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={true}
          >
            {/* 패널 헤더 + 닫기 버튼 */}
            <View style={styles.recoHeader}>
              <TouchableOpacity
                onPress={() => setPanelVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginLeft: "auto" }}   // 오른쪽 정렬
              >
                <Text style={styles.recoHeaderClose}>닫기 ✕</Text>
              </TouchableOpacity>
            </View>


            {/* 로딩 */}
            {loading && (
              <View style={styles.rowCenter}>
                <ActivityIndicator />
                <Text style={{ marginLeft: 8, fontSize: 12 }}>
                  분석 중…
                </Text>
              </View>
            )}

            {/* 에러 */}
            {!loading && errMsg && (
              <Text
                style={{
                  color: "#B91C1C",
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                {errMsg}
              </Text>
            )}

            {/* 정상 데이터 */}
            {!loading && !errMsg && hasReco && (
              <>
                                {/* Step 2: 시나리오 선택 */}
                {appStep === "scenario" && (
                  <View>
                    {/* ✅ 주소 검색 후, 이 지역 상권 요약 먼저 보여주기 */}
                    {(areaSummary || d) && (
                      <View style={{ marginBottom: 8 }}>
                        <Text style={styles.sectionTitle}>
                          이 지역 상권 요약
                        </Text>

                        {/* 위치 */}
                        {areaSummary?.locationLabel && (
                          <Text style={styles.item}>
                            • 위치: {areaSummary.locationLabel}
                          </Text>
                        )}

    {/* 인구 + 연령 분포 */}
    {areaSummary?.population && (
      <>
        {/* 총 인구 */}
        {areaSummary.population.totalLabel && (
          <Text style={styles.item}>
            • 인구: {areaSummary.population.totalLabel}
          </Text>
        )}

        {/* 연령대별 (20대~80대+) */}
        {Array.isArray(areaSummary.population.ageBands) &&
          areaSummary.population.ageBands.length > 0 && (
            <View style={{ marginTop: 2 }}>
              {areaSummary.population.ageBands.map((band) => (
                <Text key={band.label} style={styles.item}>
                  · {band.label}:{" "}
                  {band.count.toLocaleString("ko-KR")}명 (
                  {(band.rate * 100).toFixed(1)}%)
                </Text>
              ))}
            </View>
          )}

        {/* 🔹 메인 연령대 한 줄 요약 */}
        {areaSummary.population.mainAgeLabel && (
          <Text style={styles.item}>
            • 연령 요약: {areaSummary.population.mainAgeLabel}
          </Text>
        )}
      </>
    )}



                      

                        {/* 성별 */}
{genderLabel && (
  <Text style={styles.item}>
    • 성별: {genderLabel}
  </Text>
)}


                        {/* 상권/결제 */}
                        {(areaSummary?.commerce?.paymentLevelLabel ||
                          d?.commerce) && (
                          <Text style={styles.item}>
                            • 상권/결제:{" "}
                            {areaSummary?.commerce?.paymentLevelLabel ||
                              d?.commerce?.notes ||
                              `결제강도(log) ${fmtNum(
                                d?.commerce?.pay_cnt_log
                              )} · 상권레벨 ${fmtNum(
                                d?.commerce?.cmrcl_level
                              )}`}
                          </Text>
                        )}

                        {/* 상권 타입 (있으면 표시) */}
                        {areaSummary?.typeLabel && (
                          <Text style={styles.item}>
                            • 상권 타입: {areaSummary.typeLabel}
                          </Text>
                        )}
                      </View>
                    )}

                    <Text style={styles.sectionTitle}>
                      현재 상황에 더 가까운 걸 골라주세요
                    </Text>

                    {/* 🔹 A+B 통합 선택지 */}
                    <TouchableOpacity
                      style={styles.scenarioCard}
                      onPress={() => {
                        setScenario("A");   // 👉 A에 통합
                        setAppStep("flow");
                      }}
                    >

                      <Text style={styles.scenarioTitle}>
                        A. 이미 생각해둔 업종 / 프랜차이즈가 있어요
                      </Text>
                      <Text style={styles.scenarioDesc}>
                        예: 카페, 헤어샵 같은 업종은 정했고, 프랜차이즈는
                        정했거나(투썸플레이스 등) 비교해보고 싶은 경우
                      </Text>
                    </TouchableOpacity>

                    {/* 🔹 B: 아직 아무것도 정하지 못했어요 (추천 업종부터 보기) */}
<TouchableOpacity
  style={styles.scenarioCard}
  onPress={() => {
    setScenario("B");
    setAppStep("flow");
  }}
>
  <Text style={styles.scenarioTitle}>
    B. 아직 아무것도 정하지 못했어요
  </Text>
  <Text style={styles.scenarioDesc}>
    이 상권에 어울리는 업종(인기/틈새)을 먼저 추천받고 싶어요
  </Text>
</TouchableOpacity>

                  </View>
                )}


                {/* Step 3: 각 시나리오 플로우 */}
                {appStep === "flow" && (
                  <>
                    {/* 🔹 A 시나리오: 업종 + 프랜차이즈 둘 다 있음 */}
                    {scenario === "A" && (
                      <View>
                   

                        <Text style={styles.sectionTitle}>
                          어느 업종 / 프랜차이즈를 생각 중이신가요?
                        </Text>
                        <Text style={styles.dim}>
                          상단에서 업종(대분류/중분류)을 선택하고,
                          생각해두신 프랜차이즈 이름을 검색해 주세요.
                        </Text>

                        {/* 대분류 선택 */}
                        <Text style={styles.subTitle}>대분류 선택</Text>
                        <View style={styles.chipRow}>
                          {lOptions.map((l) => (
                            <Chip
                              key={l}
                              label={l}
                              active={selectedL === l}
                              status={
                                blockedL.includes(l)
                                  ? "blocked"
                                  : interestedL.includes(l)
                                  ? "liked"
                                  : "normal"
                              }
                              onPress={() => handleSelectL(l)}
                              onLongPress={() =>
                                handleToggleInterestL(l)
                              }
                            />
                          ))}
                          {lOptions.length === 0 && (
                            <Text style={styles.dim}>
                              대분류 정보가 부족합니다.
                            </Text>
                          )}
                        </View>

                        {/* 중분류 선택 */}
                        <Text style={styles.subTitle}>중분류 선택</Text>
                        {mOptions.length > 0 ? (
                          <View style={styles.chipRow}>
                            {mOptions.map((m) => (
                              <Chip
                                key={m}
                                label={m}
                                active={selectedM === m}
                                onPress={() => handleSelectM(m)}
                              />
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.dim}>
                            이 상권에서는 중분류 데이터가 거의 없어
                            대분류만 사용할 수 있어요.
                          </Text>
                        )}

                        {/* 🔹 여기 추가: 중분류 선택 시, 이 상권에서 이 업종 설명 */}
                        {selectedM && (
                          <View style={{ marginTop: 10 }}>
                            <Text style={styles.sectionTitle}>
                              이 상권에서 「{selectedM}」 업종은 어떤가요?
                            </Text>
                            <Text style={styles.modalReason}>
                              {buildCategoryWhy(selectedM, d, storeSummary)}
                            </Text>
                          </View>
                        )}



                        {/* 프랜차이즈 검색 */}
                        <Text style={styles.subTitle}>
                          프랜차이즈 이름 검색
                        </Text>
                        <TextInput
                          value={brandSearchQueryA}
                          onChangeText={setBrandSearchQueryA}
                          placeholder="예: 투썸플레이스, 이디야커피, BBQ..."
                          style={styles.searchInput}
                        />
                        {(!selectedL && !selectedM) && (
                          <Text style={styles.dim}>
                            ※ 최소한 대분류를 하나 선택하면 해당 업종
                            계열 프랜차이즈 목록을 불러올 수 있어요.
                          </Text>
                        )}

                        {brandLoading && (
                          <Text style={styles.dim}>
                            프랜차이즈 불러오는 중…
                          </Text>
                        )}
                        {!brandLoading && brandErr && (
                          <Text
                            style={{ color: "#B91C1C", fontSize: 12 }}
                          >
                            {brandErr}
                          </Text>
                        )}

                        {!brandLoading && !brandErr && (
                          <>
                            <Text
                              style={[
                                styles.subTitle,
                                { marginTop: 8 },
                              ]}
                            >
                              검색 결과
                              {searchedBrandListA.length > 0 &&
                                ` (TOP ${Math.min(
                                  10,
                                  searchedBrandListA.length
                                )})`}
                            </Text>

                            {searchedBrandListA.length > 0 ? (
                              <View style={{ marginTop: 4 }}>
                                {searchedBrandListA
                                  .slice(0, 10)
                                  .map((b, idx) => (
                                    <TouchableOpacity
                                      key={`${b.brandNm}-${idx}`}
                                      onPress={() => {
                                        setSelectedBrandA(b);
                                        loadBrandReco(b);   // ✅ A 시나리오 상세에도 백엔드 이유 붙이기
                                      }}
                                    >

                                      <Text style={styles.item}>
                                        <Text style={styles.brandRank}>
                                          {idx + 1}.
                                        </Text>{" "}
                                        <Text
                                          style={styles.brandName}
                                        >
                                          {b.brandNm}
                                        </Text>
                                        {b.frcsCnt != null && (
                                          <Text
                                            style={
                                              styles.brandMeta
                                            }
                                          >
                                            {"  · 가맹점 "}
                                            {b.frcsCnt}개
                                          </Text>
                                        )}
                                        {b.avrgSlsAmt != null && (
                                          <Text
                                            style={
                                              styles.brandMeta
                                            }
                                          >
                                            {"  · 평균 매출 "}
                                            {Number(
                                              b.avrgSlsAmt
                                            ).toLocaleString()}
                                            원
                                          </Text>
                                        )}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                              </View>
                            ) : (
                              <Text style={styles.dim}>
                                프랜차이즈 검색 결과가 없습니다.
                                업종 선택을 변경하거나, 다른 이름으로
                                검색해 보세요.
                              </Text>
                            )}
                          </>
                        )}

                        {/* 선택된 브랜드 상세 분석 */}
                        {selectedBrandA && (
                          <View style={{ marginTop: 12 }}>
                            <View style={styles.divider} />
                            <Text style={styles.sectionTitle}>
                              선택한 프랜차이즈
                            </Text>
                            <Text style={styles.recoItem}>
                              {selectedBrandA.indutyLclasNm} &gt;{" "}
                              {selectedBrandA.indutyMlsfcNm}
                            </Text>
                            <Text style={styles.recoItem}>
                              「{selectedBrandA.brandNm}」
                            </Text>

                            {/* 브랜드 기본 정보 */}
                            <View style={{ marginTop: 6 }}>
                              {selectedBrandA.frcsCnt != null && (
                                <Text style={styles.item}>
                                  • 가맹점 수:{" "}
                                  {selectedBrandA.frcsCnt}개
                                </Text>
                              )}
                              {selectedBrandA.avrgSlsAmt != null && (
                                <Text style={styles.item}>
                                  • 평균 매출:{" "}
                                  {Number(
                                    selectedBrandA.avrgSlsAmt
                                  ).toLocaleString()}
                                  원
                                </Text>
                              )}
                            </View>

                            {/* 상권 요약 */}
                            {d && (
                              <>
                                <Text
                                  style={[
                                    styles.sectionTitle,
                                    { marginTop: 10 },
                                  ]}
                                >
                                  이 상권 요약
                                </Text>
                                <Text style={styles.item}>
                                  • 인구/연령:{" "}
                                  {d.demographics?.female?.label},{" "}
                                  {d.demographics?.age20s?.label},{" "}
                                  {d.demographics?.age30s?.label}
                                </Text>
                                <Text style={styles.item}>
                                  • 상권/결제:{" "}
                                  {d.commerce?.notes ||
                                    `결제강도(log) ${fmtNum(
                                      d.commerce?.pay_cnt_log
                                    )} · 상권레벨 ${fmtNum(
                                      d.commerce?.cmrcl_level
                                    )}`}
                                </Text>
                                {d.poi && (
                                  <Text style={styles.item}>
                                    • 업종 수 {d.poi.total ?? 0}개 ·
                                    다양도 {fmtNum(d.poi.entropy)}
                                  </Text>
                                )}
                              </>
                            )}

                            {/* 추천 이유 */}
                            <Text
                              style={[
                                styles.sectionTitle,
                                { marginTop: 10 },
                              ]}
                            >
                              왜 이 상권에서 이 브랜드인가요?
                            </Text>
                            <Text style={styles.modalReason}>
                              {selectedBrandA?.whyLine
                                ? `${selectedBrandA.whyLine}\n\n${
                                    (selectedBrandA.reasons || [])
                                      .map((r) => `• ${r}`)
                                      .join("\n")
                                  }`
                                : buildBrandWhy(selectedBrandA, d)}
                            </Text>



                            {/* 하단 액션 버튼들 */}
                            <View
                              style={{
                                marginTop: 12,
                                flexDirection: "row",
                                gap: 8,
                              }}
                            >
                              <TouchableOpacity
                                style={[styles.tabBtn, { flex: 1 }]}
                                onPress={() => {
                                  // 같은 업종의 다른 프랜차이즈 보기
                                  setBrandSearchQueryA("");
                                  setSelectedBrandA(null);
                                }}
                              >
                                <Text style={styles.tabTxt}>
                                  같은 업종 다른 프랜차이즈 보기
                                </Text>
                              </TouchableOpacity>

                                <TouchableOpacity
    style={[
      styles.tabBtn,
      styles.tabBtnActive,
      { flex: 1 },
    ]}
    onPress={() => {
      // 👉 이 업종 기준으로 다른 업종 추천 보러 가기 → B 시나리오로 이동
      if (selectedBrandA.indutyLclasNm) {
        setSelectedL(selectedBrandA.indutyLclasNm);
      }
      if (selectedBrandA.indutyMlsfcNm) {
        setSelectedM(selectedBrandA.indutyMlsfcNm);
      }
      setScenario("B");     // 🔴 C → 🟢 B 로 변경
      setAppStep("flow");
      // setStep("category"); // B에서는 step 안 쓰면 이 줄은 지워도 됨
    }}
  >
    <Text style={styles.tabTxtActive}>
      다른 업종 추천 받으러 가기
    </Text>
  </TouchableOpacity>

                            </View>
                          </View>
                        )}
                      </View>
                    )}

                    {/* 🔹 B 시나리오: 업종만 있음 (브랜드는 아직) */}
                    {scenario === "B" && (
  <View>
    {whyLine && (
      <View style={styles.whyBadge}>
        <Text style={styles.whyText}>
          {whyLine}
        </Text>
      </View>
    )}

    <Text style={styles.sectionTitle}>
      어떤 업종(중분류)을 생각 중이신가요?
    </Text>
    <Text style={styles.dim}>
      먼저 업종(대분류/중분류)을 고른 뒤, 해당
      업종과 관련된 프랜차이즈 목록을 비교해 보세요.
    </Text>

                        {/* 대분류 선택 */}
                        <Text style={styles.subTitle}>대분류 선택</Text>
                        <View style={styles.chipRow}>
                          {lOptions.map((l) => (
                            <Chip
                              key={l}
                              label={l}
                              active={selectedL === l}
                              status={
                                blockedL.includes(l)
                                  ? "blocked"
                                  : interestedL.includes(l)
                                  ? "liked"
                                  : "normal"
                              }
                              onPress={() => handleSelectL(l)}
                              onLongPress={() =>
                                handleToggleInterestL(l)
                              }
                            />
                          ))}
                          {lOptions.length === 0 && (
                            <Text style={styles.dim}>
                              대분류 정보가 부족합니다.
                            </Text>
                          )}
                        </View>
                        <Text style={styles.dim}>
                          ※ 대분류 칩을 길게 누르면 "관심있음 → 관심없음 → 해제"
                          로 바뀌고, 관심없는 대분류는 추천에서 제외돼요.
                        </Text>

                        {/* 중분류 선택 */}
                        <Text style={styles.subTitle}>중분류 선택</Text>
                        {mOptions.length > 0 ? (
                          <View style={styles.chipRow}>
                            {mOptions.map((m) => (
                              <Chip
                                key={m}
                                label={m}
                                active={selectedM === m}
                                onPress={() => handleSelectM(m)}
                              />
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.dim}>
                            이 상권에서는 중분류 데이터가 거의 없어
                            대분류만 사용할 수 있어요.
                          </Text>
                        )}

                        {/* 선택된 중분류 설명 + 프랜차이즈 목록 */}
                        {/* 선택된 중분류 설명 + 프랜차이즈 목록 */}
    {selectedM ? (
      <View style={{ marginTop: 10 }}>
        {/* 이 상권에서 이 업종은 어떤지 */}
        <Text style={styles.sectionTitle}>
          이 상권에서 「{selectedM}」 업종은 어떤가요?
        </Text>
        <Text style={styles.modalReason}>
          {buildCategoryWhy(selectedM, d, storeSummary)}
        </Text>


                            {/* 관련 프랜차이즈 목록 */}
                            <Text
                              style={[
                                styles.subTitle,
                                { marginTop: 10 },
                              ]}
                            >
                              이 업종의 프랜차이즈 목록
                              {brandListForB.length > 0 &&
                                ` (TOP ${Math.min(
                                  10,
                                  brandListForB.length
                                )})`}
                            </Text>
                            {brandLoading && (
                              <Text style={styles.dim}>
                                프랜차이즈 불러오는 중…
                              </Text>
                            )}
                            {!brandLoading && !brandErr && (
                              brandListForB.length > 0 ? (
                                <View style={{ marginTop: 4 }}>
                                  {brandListForB
                                    .slice(0, 10)
                                    .map((b, idx) => (
                                      <TouchableOpacity
                                        key={`${b.brandNm}-${idx}`}
                                        onPress={() =>
                                          openBrandModal(b)
                                        }
                                      >
                                        <Text style={styles.item}>
                                          <Text
                                            style={styles.brandRank}
                                          >
                                            {idx + 1}.
                                          </Text>{" "}
                                          <Text
                                            style={styles.brandName}
                                          >
                                            {b.brandNm}
                                          </Text>
                                          {b.frcsCnt != null && (
                                            <Text
                                              style={
                                                styles.brandMeta
                                              }
                                            >
                                              {"  · 가맹점 "}
                                              {b.frcsCnt}
                                              개
                                            </Text>
                                          )}
                                          {b.avrgSlsAmt != null && (
                                            <Text
                                              style={
                                                styles.brandMeta
                                              }
                                            >
                                              {"  · 평균 매출 "}
                                              {Number(
                                                b.avrgSlsAmt
                                              ).toLocaleString()}
                                              원
                                            </Text>
                                          )}
                                        </Text>
                                      </TouchableOpacity>
                                    ))}
                                </View>
                              ) : (
                                <Text style={styles.dim}>
                                  선택한 중분류에 해당하는 프랜차이즈
                                  정보가 없습니다.
                                </Text>
                              )
                            )}
                            {!brandLoading && brandErr && (
                              <Text
                                style={{
                                  color: "#B91C1C",
                                  fontSize: 12,
                                }}
                              >
                                {brandErr}
                              </Text>
                            )}
                          </View>
                        ) : (
                          <Text
        style={[
          styles.dim,
          { marginTop: 8 },
        ]}
      >
        ※ 중분류 업종을 먼저 선택하면, 이 상권에서
        해당 업종이 어떤지와 관련 프랜차이즈를
        보여드릴게요.
      </Text>
    )}

    {/* 🔹 (NEW) 현황: Baseline – 현재 많이 들어선 업종 TOP 5 */}
    {d?.poi?.topMost && d.poi.topMost.length > 0 && (
      <View style={{ marginTop: 16 }}>
        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>
          이 지역에서 많이 보이는 업종 (현황)
        </Text>
        <Text style={styles.dim}>
          현재 이 위치 주변 반경 내에서 점포 수가 많은 업종 TOP 5입니다.
        </Text>

        {d.poi.topMost.map((it) => (
          <Text key={it.category} style={styles.item}>
            • {it.category}
            <Text style={styles.recoScore}>
              {"  "}
              점포 {it.count}개 · 점유율{" "}
              {(it.share * 100).toFixed(1)}%
            </Text>
          </Text>
        ))}

        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => {
            setPoiModalType("many");
            setPoiModalVisible(true);
          }}
        >
          <Text style={styles.advancedToggleText}>
            상권 업종 분포 자세히 보기 &gt;
          </Text>
        </TouchableOpacity>
      </View>
    )}

    {/* 🔹 이 상권 추천 업종 (인기 / 틈새) – 기존 로직 그대로 */}
    <View style={{ marginTop: 16 }}>
      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>
        이 상권 추천 업종 보기
      </Text>
      <Text style={styles.dim}>
        추천 기준을 고르면, 이 상권에 어울리는 업종을
        인기/틈새 위주로 5개씩 보여드려요.
      </Text>

      {/* 추천 기준 (전략) */}
      <Text style={styles.subTitle}>추천 기준</Text>
      <View style={styles.chipRow}>
        <Chip
          label="인기 업종 위주"
          active={strategy === "trend"}
          onPress={() => {
            if (strategy === "trend") return;
            const next = "trend";
            setStrategy(next);
            refetchWithStrategy(next);
          }}
        />
        <Chip
          label="틈새 업종 위주"
          active={strategy === "gap"}
          onPress={() => {
            if (strategy === "gap") return;
            const next = "gap";
            setStrategy(next);
            refetchWithStrategy(next);
          }}
        />
      </View>


      {/* 업종 분포 필터 (많이/적게 존재)
      <Text style={styles.subTitle}>업종 분포 필터</Text>
      <View style={styles.chipRow}>
        <Chip
          label="많이 존재하는 업종만"
          active={densityFilter === "many"}
          onPress={() =>
            setDensityFilter(
              densityFilter === "many" ? "all" : "many"
            )
          }
        />
        <Chip
          label="거의 없는 업종만"
          active={densityFilter === "few"}
          onPress={() =>
            setDensityFilter(
              densityFilter === "few" ? "all" : "few"
            )
          }
        />
      </View>  */}

      {/* 실제 추천 리스트 */}
      {effectiveTop.length > 0 && (
        <>
          {/* 탭 스위치 */}
          <View style={styles.tabs}>
            <TabButton
              label="일반 창업 가능"
              active={activeTab === "openable"}
              onPress={() => setActiveTab("openable")}
            />
            <TabButton
              label="전문/허가 필요"
              active={activeTab === "licensed"}
              onPress={() => setActiveTab("licensed")}
            />
          </View>

          <View style={styles.divider} />

          {/* 선택한 대분류 안에서 중분류 TOP 5 */}
          {selectedL && midTop5.length > 0 && (
            <>
              <Text style={styles.recoTitle}>
                선택한 대분류 안에서 중분류 추천 (TOP 5)
              </Text>
              {renderMidList(midTop5)}
              <View style={styles.divider} />
            </>
          )}

          {/* 소분류 TOP 5 */}
          <Text style={styles.recoTitle}>
            {activeTab === "openable"
              ? "소분류 추천 - 일반 창업 가능 (5개)"
              : "소분류 추천 - 전문/허가 필요 (5개)"}
          </Text>

          {(activeTab === "openable" ? openable5 : licensed5).map(
            (r) => {
              const meta = getMeta(r.category);
              return (
                <Text key={r.category} style={styles.recoItem}>
                  • {r.category}
                  <Text style={styles.recoScore}>
                    {" "}
                    {typeof r.score === "number"
                      ? r.score.toFixed(3)
                      : String(r.score)}
                  </Text>
                  {!meta.openable && (
                    <Text style={styles.licenseBadge}>
                      {" "}
                      허가/자격 필요
                    </Text>
                  )}
                  {r._fromOtherGroup && (
                    <Text style={styles.altBadge}>
                      {" "}
                      대체추천
                    </Text>
                  )}
                </Text>
              );
            }
          )}

          {filteredTop.length === 0 &&
            (selectedL ||
              selectedM ||
              searchQuery.trim() ||
              densityFilter !== "all") && (
              <Text style={[styles.dim, { marginTop: 4 }]}>
                선택한 대/중분류나 필터, 검색 조건에 딱 맞는 업종은
                없어서, 전체 추천 기준으로 보여드리고 있어요.
              </Text>
            )}
        </>
      )}
    </View>
  </View>
)}

                    
                    
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* 주소 입력 (Step 1 - 위치 입력) */}
      <View style={styles.inputContainer}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="상세주소 입력"
          style={styles.input}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Button
          title={loading ? "검색 중…" : "검색"}
          onPress={handleSearch}
          disabled={loading}
        />
      </View>

      {/* 상권 정보 상세 오버레이 */}
      {poiModalVisible && (
        <View style={styles.fullscreenOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {poiModalType === "many"
                  ? "이 지역에서 많이 보이는 업종 TOP 5"
                  : "이 지역에서 거의 없는 업종 TOP 5"}
              </Text>
              <TouchableOpacity
                onPress={() => setPoiModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              이 정보는 참고용 상권 정보이며, 추천/필터에 직접적인 영향을
              주지 않습니다.
            </Text>

            <ScrollView style={{ maxHeight: 240 }}>
              {(poiModalType === "many"
                ? d?.poi?.topMost || []
                : d?.poi?.leastCommon || []
              ).map((it) => (
                <View
                  key={it.category}
                  style={styles.modalItemRow}
                >
                  <Text style={styles.modalItemName}>
                    {it.category}
                  </Text>
                  <Text style={styles.modalItemMeta}>
                    점포 수 {it.count}개 · 점유율{" "}
                    {(it.share * 100).toFixed(1)}%
                  </Text>
                </View>
              ))}

              {((poiModalType === "many"
                ? d?.poi?.topMost
                : d?.poi?.leastCommon) || []
              ).length === 0 && (
                <Text style={styles.infoCardEmpty}>
                  데이터가 없습니다.
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.tabBtn, { marginTop: 12 }]}
              onPress={() => setPoiModalVisible(false)}
            >
              <Text style={styles.tabTxt}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 프랜차이즈 상세 오버레이 (B/C 시나리오용) */}
      {brandModalVisible && selectedBrandDetail && (
        <View style={styles.fullscreenOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {selectedBrandDetail.brandNm}
              </Text>
              <TouchableOpacity
                onPress={closeBrandModal}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              {selectedBrandDetail.indutyLclasNm} &gt;{" "}
              {selectedBrandDetail.indutyMlsfcNm}
            </Text>

            {/* 기본 정보 */}
            <View style={{ marginTop: 8 }}>
              {selectedBrandDetail.frcsCnt != null && (
                <Text style={styles.modalItemMeta}>
                  • 가맹점 수: {selectedBrandDetail.frcsCnt}개
                </Text>
              )}
              {selectedBrandDetail.avrgSlsAmt != null && (
                <Text style={styles.modalItemMeta}>
                  • 평균 매출:{" "}
                  {Number(
                    selectedBrandDetail.avrgSlsAmt
                  ).toLocaleString()}
                  원
                </Text>
              )}
            </View>

            {/* 추천 이유 */}
              <Text
                style={[
                  styles.sectionTitle,
                  { marginTop: 12 },
                ]}
              >
                왜 이 프랜차이즈를 추천했나요?
              </Text>
              <Text style={styles.modalReason}>
                {selectedBrandDetail?.whyLine
                  ? `${selectedBrandDetail.whyLine}\n\n${
                      (selectedBrandDetail.reasons || [])
                        .map((r) => `• ${r}`)
                        .join("\n")
                    }`
                  : buildBrandWhy(selectedBrandDetail, d)}
              </Text>



            <TouchableOpacity
              style={[styles.tabBtn, { marginTop: 12 }]}
              onPress={closeBrandModal}
            >
              <Text style={styles.tabTxt}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

/** 카테고리 분리 */
function partitionCategories(items = []) {
  const openableList = [];
  const licensedList = [];
  for (const x of items) {
    const m = getMeta(x.category);
    if (m.openable) openableList.push(x);
    else licensedList.push(x);
  }
  return { openableList, licensedList };
}

/** 5개로 고정: 부족하면 다른 그룹에서 백필 */
function fillToFive(primary, secondary) {
  const want = 5;
  const base = primary.slice(0, want);
  if (base.length >= want) return base;

  const need = want - base.length;
  const extras = secondary
    .filter((x) => !base.find((b) => b.category === x.category))
    .slice(0, need)
    .map((x) => ({ ...x, _fromOtherGroup: true }));

  return base.concat(extras);
}

/** 탭 버튼 */
function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Text style={[styles.tabTxt, active && styles.tabTxtActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** Chip 컴포넌트 */
function Chip({
  label,
  active,
  onPress,
  onLongPress,
  status,
}) {
  const isLiked = status === "liked";
  const isBlocked = status === "blocked";

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.chip,
        active && styles.chipActive,
        isLiked && !active && styles.chipLiked,
        isBlocked && styles.chipBlocked,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          (active || isLiked) && styles.chipTextActive,
          isBlocked && styles.chipTextBlocked,
        ]}
      >
        {label}
        {isLiked && " ★"}
        {isBlocked && " ×"}
      </Text>
    </TouchableOpacity>
  );
}

/** Why 폴백 */
function buildWhyFallback(rec) {
  try {
    if (!rec) return null;
    const fv = rec?.debug?.featureVector || {};
    const byCate = rec?.debug?.poi?.byCate || {};
    const top0 = rec?.topCategories?.[0];
    const topCategory = top0?.category;
    if (!topCategory) return null;

    const {
      rate_20s = 0,
      rate_30s = 0,
      female_rate = 0,
      cmrcl_level = 0,
      pay_cnt_log = 0,
      poi_entropy = 0,
    } = fv;

    const reasons = [];
    if (rate_20s >= 0.22) reasons.push("20대 비중 높음");
    if (rate_30s >= 0.2) reasons.push("30대 비중 높음");
    if (female_rate >= 0.5) reasons.push("여성 비중 높음");

    const payHigh = pay_cnt_log >= 6.0;
    const payMid = pay_cnt_log >= 5.0;
    const lvlHigh = cmrcl_level >= 0.6;
    const lvlMid = cmrcl_level >= 0.3;
    if (payHigh || lvlHigh) reasons.push("결제활동 상위권");
    else if (payMid || lvlMid) reasons.push("상권 활력 보통");

    if (poi_entropy >= 1.5) reasons.push("업종 다양도 높음");

    const total =
      Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = byCate[topCategory] || 0;
    const share = same / total;
    if (share >= 0.5) reasons.push("동일 업종 과밀");
    else if (share <= 0.2 && total > 3)
      reasons.push("동일 업종 드묾");

    const left = reasons.length
      ? `이 지역은 ${reasons.join(" + ")}`
      : "이 지역은";
    return `${left} → ${topCategory} 추천`;
  } catch {
    return null;
  }
}

/** details 폴백 */
function buildDetailsFallback(rec) {
  try {
    if (!rec) return null;
    const fv = rec?.debug?.featureVector || {};
    const byCate = rec?.debug?.poi?.byCate || {};
    const top0 = rec?.topCategories?.[0];
    const topCategory = top0?.category || null;

    const {
      rate_20s,
      rate_30s,
      female_rate,
      cmrcl_level,
      pay_cnt_log,
      poi_entropy,
      poi_total,
    } = fv;

    const _rate_20s = rate_20s ?? 0;
    const _rate_30s = rate_30s ?? 0;
    const _female_rate = female_rate ?? 0;
    const _cmrcl_level = cmrcl_level ?? 0;
    const _pay_cnt_log = pay_cnt_log ?? 0;
    const _poi_entropy = poi_entropy ?? 0;
    const _poi_total = poi_total ?? 0;

    const total =
      Object.values(byCate).reduce((a, b) => a + b, 0) || 1;
    const same = topCategory ? byCate[topCategory] || 0 : 0;
    const share = same / total;

    const entries = Object.entries(byCate).sort(
      (a, b) => b[1] - a[1]
    );
    const topMost = entries.slice(0, 5).map(([k, v]) => ({
      category: k,
      count: v,
      share: v / total,
    }));
    const leastCommon = entries.slice(-5).map(([k, v]) => ({
      category: k,
      count: v,
      share: v / total,
    }));

    const TH = {
      RATE20S_HIGH: 0.22,
      RATE30S_HIGH: 0.2,
      FEMALE_RATE_HIGH: 0.5,
      PAY_LOG_HIGH: 6.0,
      PAY_LOG_MID: 5.0,
      CMR_LEVEL_HIGH: 0.6,
      CMR_LEVEL_MID: 0.3,
      ENTROPY_HIGH: 1.5,
      COMP_OVER: 0.5,
      COMP_UNDER: 0.2,
      COMP_MIN_TOTAL: 3,
    };

    const pctLocal = (x) => `${(x * 100).toFixed(1)}%`;

    const hasPayFields =
      Object.prototype.hasOwnProperty.call(
        fv,
        "pay_cnt_log"
      ) &&
      Object.prototype.hasOwnProperty.call(
        fv,
        "cmrcl_level"
      );

    return {
      demographics: {
        female: {
          value: _female_rate,
          label: `여성 ${pctLocal(_female_rate)}`,
        },
        age20s: {
          value: _rate_20s,
          label: `20대 ${pctLocal(_rate_20s)}`,
        },
        age30s: {
          value: _rate_30s,
          label: `30대 ${pctLocal(_rate_30s)}`,
        },
        flags: {
          femaleHigh: _female_rate >= TH.FEMALE_RATE_HIGH,
          age20sHigh: _rate_20s >= TH.RATE20S_HIGH,
          age30sHigh: _rate_30s >= TH.RATE30S_HIGH,
        },
      },
      commerce: {
        cmrcl_level: _cmrcl_level,
        pay_cnt_log: _pay_cnt_log,
        notes:
          hasPayFields &&
          _pay_cnt_log === 0 &&
          _cmrcl_level === 0
            ? "상권(결제) 데이터 없음/부족"
            : undefined,
        flags: {
          payHigh: _pay_cnt_log >= TH.PAY_LOG_HIGH,
          payMid: _pay_cnt_log >= TH.PAY_LOG_MID,
          lvlHigh: _cmrcl_level >= TH.CMR_LEVEL_HIGH,
          lvlMid: _cmrcl_level >= TH.CMR_LEVEL_MID,
        },
      },
      poi: {
        total: _poi_total,
        entropy: _poi_entropy,
        topMost,
        leastCommon,
        competition: {
          topCategory,
          sameCount: same,
          sameShare: share,
          label:
            share >= TH.COMP_OVER
              ? "동일 업종 과밀"
              : share <= TH.COMP_UNDER &&
                total > TH.COMP_MIN_TOTAL
              ? "동일 업종 드묾"
              : "보통",
        },
        flags: { highDiversity: _poi_entropy >= TH.ENTROPY_HIGH },
      },
    };
  } catch {
    return null;
  }
}

/** 프랜차이즈 추천 이유 설명 */
function buildBrandWhy(brand, details) {
  if (!brand || !details) {
    return "이 상권의 인구·소비·업종 분포를 종합적으로 고려해 추천된 프랜차이즈입니다.";
  }

  const mName = brand.indutyMlsfcNm || "해당 업종";
  const flags = details.demographics?.flags || {};
  const commerceFlags = details.commerce?.flags || {};
  const poiInfo = details.poi || {};

  const parts = [];

  // 인구 특성
  const demoTexts = [];
  if (flags.age20sHigh) demoTexts.push("20대 비중이 높은 상권");
  if (flags.age30sHigh) demoTexts.push("30대 비중이 높은 상권");
  if (flags.femaleHigh) demoTexts.push("여성 비중이 높은 상권");
  if (demoTexts.length > 0) {
    parts.push(demoTexts.join(" · "));
  }

  // 상권/결제 특성
  if (commerceFlags.payHigh || commerceFlags.lvlHigh) {
    parts.push("결제 활동과 상권 활력이 모두 높은 지역");
  } else if (commerceFlags.payMid || commerceFlags.lvlMid) {
    parts.push("결제 활동과 상권 활력이 보통 이상인 지역");
  }

  // 업종 분포
  if (poiInfo.competition?.label === "동일 업종 드묾") {
    if (poiInfo.competition.topCategory) {
      parts.push(
        `${poiInfo.competition.topCategory} 업종이 상대적으로 드문 편`
      );
    } else {
      parts.push("해당 업종 계열 점포가 상대적으로 드문 편");
    }
  } else if (poiInfo.competition?.label === "동일 업종 과밀") {
    if (poiInfo.competition.topCategory) {
      parts.push(
        `${poiInfo.competition.topCategory} 업종이 이미 많은 편`
      );
    } else {
      parts.push("해당 업종 계열 점포가 이미 많은 편");
    }
  }

  const head =
    parts.length > 0
      ? `이 상권은 ${parts.join(", ")}입니다.`
      : "이 상권의 인구·소비·업종 분포를 기반으로 분석했습니다.";

  const tail = `이러한 상권 특성에 비춰볼 때, ${mName} 계열 프랜차이즈인 「${brand.brandNm}」는 이 지역에서 수요를 확보할 가능성이 높아 추천되었습니다.`;

  return `${head}\n\n${tail}`;
}

/** 업종(중분류) 관점 설명 */
function buildCategoryWhy(mName, details, storeSummary) {
  if (!mName) {
    return "이 상권의 인구·소비·업종 분포를 종합적으로 고려해 추천한 업종입니다.";
  }

  const demo = details?.demographics;
  const commerce = details?.commerce;
  const poi = details?.poi;

  const parts = [];

  // 1) 인구 특성
  if (demo?.flags) {
    const ageBits = [];
    if (demo.flags.age20sHigh) {
      ageBits.push(demo.age20s?.label ?? "20대 비중이 높은 상권");
    }
    if (demo.flags.age30sHigh) {
      ageBits.push(demo.age30s?.label ?? "30대 비중이 높은 상권");
    }
    if (ageBits.length > 0) {
      parts.push(ageBits.join(" · "));
    }
    if (demo.flags.femaleHigh) {
      parts.push(demo.female?.label ?? "여성 비중이 높은 상권");
    }
  }

  // 2) 상권/결제 특성
  if (commerce?.flags) {
    if (commerce.flags.payHigh || commerce.flags.lvlHigh) {
      parts.push("결제 활동과 상권 활력이 높은 지역");
    } else if (commerce.flags.payMid || commerce.flags.lvlMid) {
      parts.push("결제 활동과 상권 활력이 보통 이상인 지역");
    } else if (commerce.notes) {
      parts.push(commerce.notes);
    }
  }

  // 3) 주변 업종 분포 요약
  if (storeSummary?.summaryLine) {
    parts.push(storeSummary.summaryLine);
  } else if (poi?.total != null) {
    parts.push(
      `주변에 업종 ${poi.total}개, 다양도(entropy) ${
        poi.entropy?.toFixed?.(2) ?? "-"
      } 수준`
    );
  }

  // 4) 경쟁도
  if (poi?.competition?.label === "동일 업종 드묾") {
    parts.push("비슷한 업종이 상대적으로 적어 진입 여지가 있는 편입니다.");
  } else if (poi?.competition?.label === "동일 업종 과밀") {
    parts.push("유사 업종이 이미 많은 편이라 경쟁이 치열할 수 있습니다.");
  }

  const head =
    parts.length > 0
      ? `이 상권은 ${parts.join(", ")}입니다.`
      : "이 상권의 인구·소비·업종 분포를 기반으로 분석했습니다.";

  const tail = `이러한 상권 특성을 고려했을 때, 「${mName}」 업종은 이 지역에서 수요를 확보할 잠재력이 있어 추천되는 업종입니다.`;

  return `${head}\n\n${tail}`;
}

function pickGuFromFull(full) {
  if (!full) return null;
  const parts = full.split(" ").filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

/** 표시용 유틸 */
function fmtNum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "-";
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}


const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    marginRight: 10,
    padding: 8,
    borderRadius: 5,
  },
  recoContainer: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 70,
    backgroundColor: "white",
    padding: 12,
    borderRadius: 10,
    elevation: 5,
    maxHeight: "60%",
  },
  recoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  recoHeaderTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  recoHeaderClose: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "600",
  },
  rowCenter: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  whyBadge: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  whyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 4,
    marginTop: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  tabBtnActive: { backgroundColor: "white", elevation: 2 },
  tabTxt: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
  tabTxtActive: { color: "#111827" },
  sectionTitle: { marginTop: 10, fontWeight: "700", fontSize: 13 },
  subTitle: { marginTop: 6, fontWeight: "600", fontSize: 12 },
  item: { fontSize: 12, color: "#111", marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 8,
  },
  recoTitle: { fontWeight: "700", marginBottom: 6, fontSize: 13 },
  recoItem: { fontSize: 14, marginVertical: 2 },
  recoScore: { color: "#666", fontSize: 12 },
  licenseBadge: {
    fontSize: 10,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  altBadge: {
    fontSize: 10,
    color: "#2563EB",
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 4,
  },
  dim: { fontSize: 12, color: "#6B7280" },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    marginBottom: 4,
  },
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  chipText: {
    fontSize: 11,
    color: "#4B5563",
  },
  chipTextActive: {
    color: "#F9FAFB",
  },
  chipLiked: {
    backgroundColor: "#E0F2FE",
    borderColor: "#38BDF8",
  },
  chipBlocked: {
    backgroundColor: "#F3F4F6",
    borderColor: "#D1D5DB",
    opacity: 0.6,
  },
  chipTextBlocked: {
    color: "#9CA3AF",
    textDecorationLine: "line-through",
  },
  brandRank: { fontWeight: "600" },
  brandName: { fontWeight: "600" },
  brandMeta: { fontSize: 11, color: "#4B5563" },
  searchInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
  },
  breadcrumb: {
    marginTop: 4,
    fontSize: 11,
    color: "#6B7280",
  },
  advancedToggle: {
    marginTop: 8,
    paddingVertical: 6,
  },
  advancedToggleText: {
    fontSize: 12,
    color: "#2563EB",
    fontWeight: "600",
  },
  advancedBox: {
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  infoCardRow: {
    flexDirection: "row",
    marginTop: 6,
    gap: 8,
  },
  infoCard: {
    flex: 1,
    backgroundColor: "#F9FAFB",
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  infoCardTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  infoCardItem: {
    fontSize: 11,
    color: "#4B5563",
  },
  infoCardEmpty: {
    fontSize: 11,
    color: "#9CA3AF",
  },
  fullscreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    zIndex: 999,
  },
  modalBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalCloseText: {
    fontSize: 16,
    color: "#6B7280",
    fontWeight: "600",
  },
  modalSub: {
    fontSize: 11,
    color: "#6B7280",
    marginBottom: 8,
  },
  modalItemRow: {
    marginTop: 6,
  },
  modalItemName: {
    fontSize: 13,
    fontWeight: "600",
  },
  modalItemMeta: {
    fontSize: 11,
    color: "#4B5563",
  },
  modalReason: {
    fontSize: 12,
    color: "#111827",
    marginTop: 4,
    lineHeight: 18,
  },
  scenarioCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginTop: 8,
    backgroundColor: "#F9FAFB",
  },
  scenarioTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  scenarioDesc: {
    marginTop: 4,
    fontSize: 11,
    color: "#6B7280",
  },
});

export default MapScreen;
