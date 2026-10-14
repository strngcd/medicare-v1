import { Pill, Sparkles } from 'lucide-react';

/** Labels and routes for the two kinds of catalog product. */
export const PRODUCT_TYPES = {
  MEDICINE: {
    type: 'MEDICINE', singular: 'medicine', title: 'Medicine', plural: 'Medicines', basePath: '/medicines', icon: Pill,
  },
  COSMETIC: {
    type: 'COSMETIC', singular: 'cosmetic', title: 'Cosmetic', plural: 'Cosmetics', basePath: '/cosmetics', icon: Sparkles,
  },
};

export const productConfig = (productType) => PRODUCT_TYPES[productType] || PRODUCT_TYPES.MEDICINE;
