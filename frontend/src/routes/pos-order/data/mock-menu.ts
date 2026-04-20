export type CategoryCode = 'coffee' | 'milktea' | 'smoothie' | 'bakery' | 'topping';

export interface MenuItem {
  id: string;
  name: string;
  categoryCode: CategoryCode;
  price: number;
  imageUrl: string;
  badge?: 'HOT' | 'NEW' | 'SALE';
  discount?: number;
  hasDrinkOptions: boolean;
}

export interface Category {
  code: CategoryCode;
  name: string;
  icon: string;
}

export const CATEGORIES: Category[] = [
  { code: 'coffee', name: 'Cà phê', icon: 'Coffee' },
  { code: 'milktea', name: 'Trà sữa', icon: 'CupSoda' },
  { code: 'smoothie', name: 'Đá xay', icon: 'Snowflake' },
  { code: 'bakery', name: 'Bánh ngọt', icon: 'Cake' },
  { code: 'topping', name: 'Topping', icon: 'Cherry' },
];

export const MENU: MenuItem[] = [
  { id: 'c1', name: 'Cà phê đen đá', categoryCode: 'coffee', price: 25000, imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400', badge: 'HOT', hasDrinkOptions: true },
  { id: 'c2', name: 'Cà phê sữa đá', categoryCode: 'coffee', price: 29000, imageUrl: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400', badge: 'HOT', hasDrinkOptions: true },
  { id: 'c3', name: 'Bạc xỉu', categoryCode: 'coffee', price: 32000, imageUrl: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400', hasDrinkOptions: true },
  { id: 'c4', name: 'Cappuccino', categoryCode: 'coffee', price: 45000, imageUrl: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400', hasDrinkOptions: true },
  { id: 'c5', name: 'Latte', categoryCode: 'coffee', price: 45000, imageUrl: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=400', discount: 20, hasDrinkOptions: true },
  { id: 'c6', name: 'Espresso', categoryCode: 'coffee', price: 35000, imageUrl: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=400', hasDrinkOptions: true },

  { id: 'm1', name: 'Trà sữa trân châu đường đen', categoryCode: 'milktea', price: 49000, imageUrl: 'https://images.unsplash.com/photo-1558857563-b371033873b5?w=400', badge: 'HOT', hasDrinkOptions: true },
  { id: 'm2', name: 'Trà sữa matcha', categoryCode: 'milktea', price: 45000, imageUrl: 'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=400', hasDrinkOptions: true },
  { id: 'm3', name: 'Trà đào cam sả', categoryCode: 'milktea', price: 42000, imageUrl: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400', badge: 'NEW', hasDrinkOptions: true },
  { id: 'm4', name: 'Hồng trà sữa', categoryCode: 'milktea', price: 39000, imageUrl: 'https://images.unsplash.com/photo-1547637589-f54c34f5d7a4?w=400', hasDrinkOptions: true },
  { id: 'm5', name: 'Trà oolong sữa', categoryCode: 'milktea', price: 42000, imageUrl: 'https://images.unsplash.com/photo-1525803377221-4f6ccdaa83a5?w=400', hasDrinkOptions: true },

  { id: 's1', name: 'Sinh tố xoài', categoryCode: 'smoothie', price: 49000, imageUrl: 'https://images.unsplash.com/photo-1623065422902-30a2d299bbe4?w=400', hasDrinkOptions: true },
  { id: 's2', name: 'Sinh tố dâu', categoryCode: 'smoothie', price: 49000, imageUrl: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=400', badge: 'NEW', hasDrinkOptions: true },
  { id: 's3', name: 'Đá xay chocolate', categoryCode: 'smoothie', price: 55000, imageUrl: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=400', hasDrinkOptions: true },
  { id: 's4', name: 'Sinh tố bơ', categoryCode: 'smoothie', price: 52000, imageUrl: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=400', hasDrinkOptions: true },

  { id: 'b1', name: 'Bánh tiramisu', categoryCode: 'bakery', price: 45000, imageUrl: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400', hasDrinkOptions: false },
  { id: 'b2', name: 'Bánh mousse chanh dây', categoryCode: 'bakery', price: 42000, imageUrl: 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400', hasDrinkOptions: false },
  { id: 'b3', name: 'Croissant bơ', categoryCode: 'bakery', price: 32000, imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400', hasDrinkOptions: false },
  { id: 'b4', name: 'Bánh flan', categoryCode: 'bakery', price: 25000, imageUrl: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400', hasDrinkOptions: false },

  { id: 't1', name: 'Trân châu đen', categoryCode: 'topping', price: 8000, imageUrl: 'https://images.unsplash.com/photo-1586195831754-1ba29b67cbee?w=400', hasDrinkOptions: false },
];

export const SIZE_OPTIONS = [
  { code: 'S', name: 'Size S', priceAdd: -5000 },
  { code: 'M', name: 'Size M', priceAdd: 0 },
  { code: 'L', name: 'Size L', priceAdd: 8000 },
];

export const SUGAR_OPTIONS = [
  { code: '0', name: '0%' },
  { code: '25', name: '25%' },
  { code: '50', name: '50%' },
  { code: '70', name: '70%' },
  { code: '100', name: '100%' },
];

export const ICE_OPTIONS = [
  { code: '0', name: 'Không đá' },
  { code: '30', name: '30%' },
  { code: '50', name: '50%' },
  { code: '70', name: '70%' },
  { code: '100', name: '100%' },
];

export const TOPPINGS = [
  { code: 'pearl', name: 'Trân châu đen', priceAdd: 8000 },
  { code: 'cheese', name: 'Kem phô mai', priceAdd: 10000 },
  { code: 'pudding', name: 'Pudding trứng', priceAdd: 10000 },
  { code: 'jelly', name: 'Thạch trái cây', priceAdd: 7000 },
  { code: 'cream', name: 'Kem tươi', priceAdd: 8000 },
];

export const VOUCHERS: Record<string, { label: string; type: 'percent' | 'fixed'; value: number }> = {
  WELCOME10: { label: 'Giảm 10% đơn hàng', type: 'percent', value: 10 },
  FREESHIP: { label: 'Giảm 15.000đ', type: 'fixed', value: 15000 },
  HAPPY50K: { label: 'Giảm 50.000đ cho đơn từ 200k', type: 'fixed', value: 50000 },
};

export const LOYALTY: Record<string, { name: string; points: number }> = {
  '0901234567': { name: 'Nguyễn An', points: 120 },
  '0912345678': { name: 'Trần Bình', points: 45 },
};
