USE rental_app;
GO

-- 1. 先确保有一个分类 (如果之前没加过的话)
IF NOT EXISTS (SELECT 1 FROM [category] WHERE id = 1)
BEGIN
    INSERT INTO [category] (name, sort_order) VALUES ('面试正装', 1);
END
GO

-- 2. 插入一条用于测试的服装数据 (请注意 specs 字段必须是严格的 JSON 数组格式)
INSERT INTO [clothing] (category_id, name, main_image, specs, rent_price, deposit_amount, status)
VALUES (
    1, 
    '高级定制深灰商务西装 男款全套', 
    'https://dummyimage.com/800x800/e0e0e0/333333.png&text=Suit+Test', 
    '["165/S", "170/M", "175/L", "180/XL"]', 
    45.00, 
    200.00, 
    1
);
GO