import api from './index';

// 행정구역 데이터 가져오기
export const getAdministrativeAreas = async ({ resId, catId }) => {
  const res = await api.get('/api/open/baroApi', {
    params: { resId, catId, type: 'json' },
  });
  return res.data;
};
