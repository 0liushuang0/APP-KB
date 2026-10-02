-- AI Knowledge Base - PostgreSQL 初始化脚本
-- 创建扩展

-- UUID 生成
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 向量检索 (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- 全文搜索 (中文支持)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- JSONB 索引支持
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- 创建枚举类型
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE document_status AS ENUM ('draft', 'pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 创建向量相似度搜索函数
CREATE OR REPLACE FUNCTION search_vectors(
    query_embedding vector(768),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 10,
    filter_source_type text DEFAULT NULL
)
RETURNS TABLE (
    id text,
    source_type text,
    source_id text,
    content text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id,
        v.source_type,
        v.source_id,
        v.content,
        1 - (v.embedding <=> query_embedding) as similarity
    FROM vectors v
    WHERE
        (filter_source_type IS NULL OR v.source_type = filter_source_type)
        AND 1 - (v.embedding <=> query_embedding) > match_threshold
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 创建审计日志表（如果不存在）
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    action VARCHAR(255) NOT NULL,
    object_type VARCHAR(255) NOT NULL,
    object_id VARCHAR(255),
    detail TEXT,
    ip VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 创建向量存储表（用于RAG）
CREATE TABLE IF NOT EXISTS vectors (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768),
    permission_snapshot JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_vectors_embedding ON vectors USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 创建加密文件元数据表
CREATE TABLE IF NOT EXISTS encrypted_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_name VARCHAR(500) NOT NULL,
    encrypted_path VARCHAR(1000) NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    encryption_key_id VARCHAR(255),
    checksum VARCHAR(64),
    uploader_id VARCHAR(255),
    is_sensitive BOOLEAN DEFAULT FALSE,
    sensitivity_level VARCHAR(50) DEFAULT 'normal',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_encrypted_files_uploader ON encrypted_files(uploader_id);

-- 完成提示
DO $$ BEGIN
    RAISE NOTICE 'AI Knowledge Base database initialized successfully';
END $$;
