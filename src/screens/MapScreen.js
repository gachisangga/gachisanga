import React, { useState } from "react";
import { View, TextInput, Button, StyleSheet } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { getCoordsByAddress } from "../api/kakaoApi";
import { getStoresInRadius } from "../api/StoresInRadius";
import Config from "react-native-config";

const MapScreen = () => {
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);

  const handleSearch = async () => {
    if (!address.trim()) return;

    // ✅ 1. 주소 → 좌표
    const result = await getCoordsByAddress(address);
    console.log("검색 결과:", result);

    if (result) {
      setCoords(result);

      // ✅ 2. 반경 내 상가 조회
      const stores = await getStoresInRadius(result);
      console.log("👉 주변 상가 리스트:", stores);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 지도 */}
      <MapView
        style={{ flex: 1 }}
        region={
          coords
            ? { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }
            : {
                latitude: 37.5665,
                longitude: 126.9780,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
              }
        }
      >
        {coords && <Marker coordinate={coords} />}
      </MapView>

      {/* 주소 입력칸 + 버튼 (아래 고정) */}
      <View style={styles.inputContainer}>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="상세주소 입력"
          style={styles.input}
        />
        <Button title="검색" onPress={handleSearch} />
      </View>
    </View>
  );
};

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
});

export default MapScreen;
