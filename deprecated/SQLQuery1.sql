IF DB_ID('rental_app') IS NULL
BEGIN
    CREATE DATABASE rental_app;
END
GO

USE rental_app;
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='user' AND xtype='U')
BEGIN
    CREATE TABLE [user] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [openid] NVARCHAR(100) NOT NULL UNIQUE,
        [nickname] NVARCHAR(100),
        [avatar_url] NVARCHAR(255),
        [phone] NVARCHAR(20),
        [status] TINYINT DEFAULT 1,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='category' AND xtype='U')
BEGIN
    CREATE TABLE [category] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [name] NVARCHAR(50) NOT NULL,
        [sort_order] INT DEFAULT 0
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='clothing' AND xtype='U')
BEGIN
    CREATE TABLE [clothing] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [category_id] INT NOT NULL,
        [name] NVARCHAR(100) NOT NULL,
        [main_image] NVARCHAR(255) NOT NULL,
        [specs] NVARCHAR(MAX) NOT NULL,
        [rent_price] DECIMAL(10,2) NOT NULL,
        [deposit_amount] DECIMAL(10,2) NOT NULL,
        [status] TINYINT DEFAULT 1,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[clothing]') AND name = 'stock')
BEGIN
    ALTER TABLE [clothing] ADD [stock] INT DEFAULT 0;
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='orders' AND xtype='U')
BEGIN
    CREATE TABLE [orders] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [order_no] NVARCHAR(50) NOT NULL UNIQUE,
        [user_id] INT NOT NULL,
        [clothing_id] INT NOT NULL,
        [selected_spec] NVARCHAR(100) NOT NULL,
        [rent_start_time] DATETIME NOT NULL,
        [rent_end_time] DATETIME NOT NULL,
        [actual_return_time] DATETIME NULL,
        [rent_amount] DECIMAL(10,2) NOT NULL,
        [deposit_amount] DECIMAL(10,2) NOT NULL,
        [total_amount] DECIMAL(10,2) NOT NULL,
        [status] TINYINT DEFAULT 0,
        [express_no] NVARCHAR(100),
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[orders]') AND name = 'paid_at')
BEGIN
    ALTER TABLE [orders] ADD [paid_at] DATETIME NULL;
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='deposit_flow' AND xtype='U')
BEGIN
    CREATE TABLE [deposit_flow] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [order_no] NVARCHAR(50) NOT NULL,
        [user_id] INT NOT NULL,
        [amount] DECIMAL(10,2) NOT NULL,
        [flow_type] TINYINT NOT NULL,
        [status] TINYINT DEFAULT 0,
        [remark] NVARCHAR(255),
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='review' AND xtype='U')
BEGIN
    CREATE TABLE [review] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [order_no] NVARCHAR(50) NOT NULL,
        [user_id] INT NOT NULL,
        [clothing_id] INT NOT NULL,
        [rating] TINYINT NOT NULL,
        [content] NVARCHAR(MAX),
        [images] NVARCHAR(MAX),
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='banner' AND xtype='U')
BEGIN
    CREATE TABLE [banner] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [title] NVARCHAR(100),
        [image_url] NVARCHAR(255) NOT NULL,
        [target_link] NVARCHAR(255),
        [sort_order] INT DEFAULT 0,
        [status] TINYINT DEFAULT 1
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[banner]') AND name = 'title')
BEGIN
    ALTER TABLE [banner] ADD [title] NVARCHAR(100);
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='admin' AND xtype='U')
BEGIN
    CREATE TABLE [admin] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [username] NVARCHAR(50) NOT NULL UNIQUE,
        [password_hash] NVARCHAR(255) NOT NULL,
        [role] TINYINT NOT NULL,
        [phone] NVARCHAR(20),
        [status] TINYINT DEFAULT 1
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='favorite' AND xtype='U')
BEGIN
    CREATE TABLE [favorite] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT NOT NULL,
        [clothing_id] INT NOT NULL,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='address' AND xtype='U')
BEGIN
    CREATE TABLE [address] (
        [id] INT IDENTITY(1,1) PRIMARY KEY,
        [user_id] INT NOT NULL,
        [consignee] NVARCHAR(50) NOT NULL,
        [phone] NVARCHAR(20) NOT NULL,
        [detailed_address] NVARCHAR(255) NOT NULL,
        [is_default] TINYINT DEFAULT 0,
        [created_at] DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT TOP 1 1 FROM [category])
BEGIN
    INSERT INTO [category] (name, sort_order) VALUES (N'面试正装', 1), (N'舞台演出', 2), (N'汉服写真', 3), (N'毕业学士服', 4);
END
GO

IF NOT EXISTS (SELECT TOP 1 1 FROM [admin])
BEGIN
    INSERT INTO [admin] (username, password_hash, role, status)
    VALUES (N'admin', N'061009', 1, 1);
END

UPDATE [clothing] SET [stock] = 10 WHERE [stock] IS NULL;
GO

ALTER TABLE [orders] ADD [paid_at] DATETIME NULL;
