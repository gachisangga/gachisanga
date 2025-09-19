import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import axios from "axios";
import Config from "react-native-config";

const BASE_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2/baroApi";

const LocationSelectScreen = () => {
  const [sidoList, setSidoList] = useState([]);
  const [sigunguList, setSigunguList] = useState([]);
  const [dongList, setDongList] = useState([]);

  const [selectedSido, setSelectedSido] = useState("");
  const [selectedSigungu, setSelectedSigungu] = useState("");
  const [selectedDong, setSelectedDong] = useState("");

  // ✅ 시/도 가져오기
  useEffect(() => {
    const fetchSido = async () => {
      try {
        const res = await axios.get(BASE_URL, {
          params: {
            ServiceKey: Config.SERVICE_KEY,
            resId: "dong",
            catId: "mega",
            type: "json",
          },
        });
        console.log("✅ 시/도 응답:", res.data);
        setSidoList(res.data.body?.items || []);
      } catch (err) {
        console.error("시/도 불러오기 실패:", err);
      }
    };
    fetchSido();
  }, []);

  // ✅ 시/도 선택 시 군/구 가져오기
  useEffect(() => {
    if (!selectedSido) return;
    const fetchSigungu = async () => {
      try {
        const res = await axios.get(BASE_URL, {
          params: {
            ServiceKey: Config.SERVICE_KEY,
            resId: "dong",
            catId: "cty",          // 고정값
            ctprvnCd: selectedSido, // 시/도 코드
            type: "json",
          },
        });
        console.log("📌 군/구 응답:", res.data);
        setSigunguList(res.data.body?.items || []);
        setDongList([]);
        setSelectedSigungu("");
        setSelectedDong("");
      } catch (err) {
        console.error("시/군/구 불러오기 실패:", err);
      }
    };
    fetchSigungu();
  }, [selectedSido]);

  // ✅ 군/구 선택 시 읍/면/동 가져오기
  useEffect(() => {
    if (!selectedSigungu) return;
    const fetchDong = async () => {
      try {
        const res = await axios.get(BASE_URL, {
          params: {
            ServiceKey: Config.SERVICE_KEY,
            resId: "dong",
            catId: "admi",          // 고정값
            signguCd: selectedSigungu, // 시군구 코드
            type: "json",
          },
        });
        console.log("📌 읍/면/동 응답:", res.data);
        setDongList(res.data.body?.items || []);
        setSelectedDong("");
      } catch (err) {
        console.error("읍/면/동 불러오기 실패:", err);
      }
    };
    fetchDong();
  }, [selectedSigungu]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>행정구역 선택</Text>

      {/* 시/도 */}
      <Picker
        selectedValue={selectedSido}
        onValueChange={(val) => {
          console.log("✅ 시/도 선택됨:", val);
          setSelectedSido(val);
        }}
      >
        <Picker.Item label="시/도를 선택하세요" value="" />
        {sidoList.map((item) => (
          <Picker.Item
            key={item.ctprvnCd}
            label={item.ctprvnNm}
            value={String(item.ctprvnCd)}
          />
        ))}
      </Picker>

      {/* 군/구 */}
      <Picker
        selectedValue={selectedSigungu}
        onValueChange={(val) => {
          console.log("✅ 시/군/구 선택됨:", val);
          setSelectedSigungu(val);
        }}
        enabled={sigunguList.length > 0}
      >
        <Picker.Item label="시/군/구를 선택하세요" value="" />
        {sigunguList.map((item) => (
          <Picker.Item
            key={item.signguCd}
            label={item.signguNm}
            value={String(item.signguCd)}
          />
        ))}
      </Picker>

      {/* 읍/면/동 */}
      <Picker
        selectedValue={selectedDong}
        onValueChange={(val) => {
          console.log("✅ 읍/면/동 선택됨:", val);
          setSelectedDong(val);
        }}
        enabled={dongList.length > 0}
      >
        <Picker.Item label="읍/면/동을 선택하세요" value="" />
        {dongList.map((item) => (
          <Picker.Item
            key={item.adongCd}
            label={item.adongNm}
            value={String(item.adongCd)}
          />
        ))}
      </Picker>

      <Text style={styles.result}>
        최종 선택: {selectedSido} {selectedSigungu} {selectedDong}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 16 },
  result: { marginTop: 24, fontSize: 16, fontWeight: "500" },
});

export default LocationSelectScreen;
