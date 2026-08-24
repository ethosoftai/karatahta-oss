// Static pricing catalog. Only "free_trial" is purchasable/active right now
// -- paid plans are display-only until we have a tax certificate to accept
// payment, so they're marked comingSoon and carry no real quota.
export const PLAN_CATALOG = [
  {
    id: 'free_trial',
    name: 'Ücretsiz Deneme',
    priceUsd: 0,
    purchasable: false,
    isDefault: true,
    comingSoon: false,
    features: ['2 video üretim hakkı', '2 kart üretim hakkı']
  },
  {
    id: 'plan_5',
    name: 'Başlangıç',
    priceUsd: 5,
    purchasable: false,
    isDefault: false,
    comingSoon: true,
    features: ['Yakında']
  },
  {
    id: 'plan_10',
    name: 'Pro',
    priceUsd: 10,
    purchasable: false,
    isDefault: false,
    comingSoon: true,
    features: ['Yakında']
  }
];
