-- 既存のD1データベースで1回だけ実行してください。
ALTER TABLE appointments ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30;
