import axios from 'axios';
import { Platform } from 'react-native';

const baseURL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:3000' // Android 에뮬레이터
    : 'http://localhost:3000'; // iOS 시뮬레이터

const api = axios.create({
  baseURL,
  timeout: 5000,
});

export default api;
