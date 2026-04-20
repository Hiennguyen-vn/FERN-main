-- ============================================================================
-- Product images — Unsplash seed, 1-to-1 mapping per product code
-- Uses Unsplash Source API with specific keywords for accurate matches.
-- Re-runnable; overwrites image_url to fix prior incorrect seeds.
-- ============================================================================

BEGIN;

-- Verified Unsplash photo IDs (hand-picked for each dish)
-- Coffee drinks
UPDATE core.product SET image_url = 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600&q=80' WHERE code = 'LATTE';
UPDATE core.product SET image_url = 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&q=80' WHERE code = 'ESPRESSO';
UPDATE core.product SET image_url = 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80' WHERE code = 'WF-DRINK-1776095831';

-- SIM products: use source.unsplash.com keyword search for reliable per-dish photos
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?pho,bo,tai,vietnamese' WHERE code = 'SIM-SMALL-PROD-0001'; -- Pho Bo Tai
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?pho,beef,vietnamese' WHERE code = 'SIM-SMALL-PROD-0002'; -- Pho Bo Chin
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?pho,ga,chicken' WHERE code = 'SIM-SMALL-PROD-0003'; -- Pho Ga
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,bo,hue' WHERE code = 'SIM-SMALL-PROD-0004'; -- Bun Bo Hue
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,rieu,crab' WHERE code = 'SIM-SMALL-PROD-0005'; -- Bun Rieu
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?hu,tieu,nam,vang' WHERE code = 'SIM-SMALL-PROD-0006'; -- Hu Tieu Nam Vang
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?mi,quang,turmeric,noodle' WHERE code = 'SIM-SMALL-PROD-0007'; -- Mi Quang
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?cao,lau,hoi,an' WHERE code = 'SIM-SMALL-PROD-0008'; -- Cao Lau
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,moc,soup' WHERE code = 'SIM-SMALL-PROD-0009'; -- Bun Moc
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?chao,rice,porridge' WHERE code = 'SIM-SMALL-PROD-0010'; -- Chao Long

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?com,tam,suon,rice' WHERE code = 'SIM-SMALL-PROD-0011'; -- Com Tam Suon
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?com,tam,bi,rice' WHERE code = 'SIM-SMALL-PROD-0012'; -- Com Tam Bi
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?com,tam,suon,bi' WHERE code = 'SIM-SMALL-PROD-0013'; -- Com Tam Suon Bi Cha
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?fried,rice,duong,chau' WHERE code = 'SIM-SMALL-PROD-0014'; -- Com Chien Duong Chau
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?hainanese,chicken,rice' WHERE code = 'SIM-SMALL-PROD-0015'; -- Com Ga Xoi Mo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?beef,rice,shaking,lucky' WHERE code = 'SIM-SMALL-PROD-0016'; -- Com Bo Luc Lac
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?fried,rice,mixed' WHERE code = 'SIM-SMALL-PROD-0017'; -- Com Rang Thap Cam
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?clay,pot,rice,vietnamese' WHERE code = 'SIM-SMALL-PROD-0018'; -- Com Tay Cam

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,mi,pork,sandwich' WHERE code = 'SIM-SMALL-PROD-0019'; -- Banh Mi Thit
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,mi,egg,vietnamese' WHERE code = 'SIM-SMALL-PROD-0020'; -- Banh Mi Op La
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,mi,sandwich,vietnamese' WHERE code = 'SIM-SMALL-PROD-0021'; -- Banh Mi Cha
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,mi,chicken' WHERE code = 'SIM-SMALL-PROD-0022'; -- Banh Mi Ga

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?spring,roll,vietnamese,goi' WHERE code = 'SIM-SMALL-PROD-0023'; -- Goi Cuon
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?shrimp,spring,roll' WHERE code = 'SIM-SMALL-PROD-0024'; -- Goi Cuon Tom
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,cha,hanoi' WHERE code = 'SIM-SMALL-PROD-0025'; -- Bun Cha
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,thit,nuong,pork' WHERE code = 'SIM-SMALL-PROD-0026'; -- Bun Thit Nuong
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,bo,nam,bo' WHERE code = 'SIM-SMALL-PROD-0027'; -- Bun Bo Nam Bo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,dau,mam,tom' WHERE code = 'SIM-SMALL-PROD-0028'; -- Bun Dau Mam Tom
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,ca,fish,noodle' WHERE code = 'SIM-SMALL-PROD-0029'; -- Bun Ca
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,mam,fermented' WHERE code = 'SIM-SMALL-PROD-0030'; -- Bun Mam
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,cha,ca,danang' WHERE code = 'SIM-SMALL-PROD-0031'; -- Bun Cha Ca
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?bun,tom,shrimp,noodle' WHERE code = 'SIM-SMALL-PROD-0032'; -- Bun Tom

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?beef,stir,fried,noodle' WHERE code = 'SIM-SMALL-PROD-0033'; -- Mi Xao Bo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?seafood,fried,noodle' WHERE code = 'SIM-SMALL-PROD-0034'; -- Mi Xao Hai San
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?pho,xao,stir,fried' WHERE code = 'SIM-SMALL-PROD-0035'; -- Pho Xao
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?beef,stir,vegetables' WHERE code = 'SIM-SMALL-PROD-0036'; -- Bo Xao Rau
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?lemongrass,chilli,chicken' WHERE code = 'SIM-SMALL-PROD-0037'; -- Ga Xao Sa Ot
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?shrimp,broccoli,stir,fried' WHERE code = 'SIM-SMALL-PROD-0038'; -- Tom Xao Bong Cai
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?water,spinach,garlic,vietnamese' WHERE code = 'SIM-SMALL-PROD-0039'; -- Rau Muong Xao Toi
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?tofu,tomato,sauce' WHERE code = 'SIM-SMALL-PROD-0040'; -- Dau Hu Sot Ca

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,xeo,sizzling,crepe' WHERE code = 'SIM-SMALL-PROD-0041'; -- Banh Xeo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,khot,mini,pancake' WHERE code = 'SIM-SMALL-PROD-0042'; -- Banh Khot
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,cuon,rolled,pancake' WHERE code = 'SIM-SMALL-PROD-0043'; -- Banh Cuon
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,beo,steamed,rice,cake' WHERE code = 'SIM-SMALL-PROD-0044'; -- Banh Beo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,bot,loc,dumpling' WHERE code = 'SIM-SMALL-PROD-0045'; -- Banh Bot Loc
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,canh,thick,noodle' WHERE code = 'SIM-SMALL-PROD-0046'; -- Banh Canh
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?cha,gio,fried,spring,roll' WHERE code = 'SIM-SMALL-PROD-0047'; -- Cha Gio
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?nem,nuong,grilled,pork,skewer' WHERE code = 'SIM-SMALL-PROD-0048'; -- Nem Nuong

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?goi,ga,chicken,salad,vietnamese' WHERE code = 'SIM-SMALL-PROD-0049'; -- Goi Ga
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?mango,salad,vietnamese' WHERE code = 'SIM-SMALL-PROD-0050'; -- Goi Xoai
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?fried,tofu,crispy' WHERE code = 'SIM-SMALL-PROD-0051'; -- Dau Hu Chien
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?vegan,rice,bowl,vegetarian' WHERE code = 'SIM-SMALL-PROD-0052'; -- Com Chay
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?canh,chua,sour,soup' WHERE code = 'SIM-SMALL-PROD-0053'; -- Canh Chua

UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?vietnamese,iced,coffee,milk' WHERE code = 'SIM-SMALL-PROD-0054'; -- Ca Phe Sua Da
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?black,coffee,iced' WHERE code = 'SIM-SMALL-PROD-0055'; -- Ca Phe Den
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?iced,tea,vietnamese' WHERE code = 'SIM-SMALL-PROD-0056'; -- Tra Da
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?sugarcane,juice,green' WHERE code = 'SIM-SMALL-PROD-0057'; -- Nuoc Mia
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?avocado,smoothie,shake' WHERE code = 'SIM-SMALL-PROD-0058'; -- Sinh To Bo
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?che,ba,mau,dessert,three,color' WHERE code = 'SIM-SMALL-PROD-0059'; -- Che Ba Mau
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banana,coconut,dessert,che' WHERE code = 'SIM-SMALL-PROD-0060'; -- Che Chuoi

-- Ad-hoc items with no unique match (fallback to generic VN food)
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?vietnamese,food' WHERE code = 'HN';
UPDATE core.product SET image_url = 'https://source.unsplash.com/600x600/?banh,da,heo,pork,skin' WHERE code = 'HN11';

COMMIT;
