-- ================================================================
-- 冰箱管家 v5 数据库迁移
-- 从单行 JSON blob 改为独立表，消除并发写入冲突
-- ================================================================

-- 1. 创建房间表（每个房间独立一行）
CREATE TABLE IF NOT EXISTS fridge_rooms (
  code      TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  owner_id  TEXT NOT NULL DEFAULT '',
  members   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE fridge_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_rooms" ON fridge_rooms FOR ALL USING (true) WITH CHECK (true);

-- 2. 创建食材表（每个食材独立一行，解决并发冲突）
CREATE TABLE IF NOT EXISTS fridge_items (
  id          TEXT PRIMARY KEY,
  room_code   TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT DEFAULT 'other',
  expiry_date TEXT DEFAULT '',
  quantity    INT DEFAULT 1,
  unit        TEXT DEFAULT '份',
  note        TEXT DEFAULT '',
  added_by    TEXT DEFAULT '',
  updated_at  BIGINT NOT NULL DEFAULT 0,
  added_at    BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fridge_items_room ON fridge_items (room_code);
ALTER TABLE fridge_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_items" ON fridge_items FOR ALL USING (true) WITH CHECK (true);

-- 3. 从旧表迁移数据（如果存在）
DO $$
DECLARE
  old_data JSONB;
  room_code TEXT;
  room_data JSONB;
  item_data JSONB;
  item_key TEXT;
BEGIN
  -- 读取旧数据
  SELECT value INTO old_data FROM fridge_data WHERE key = 'db';
  IF old_data IS NOT NULL AND old_data ? 'rooms' THEN
    FOR room_code, room_data IN SELECT * FROM jsonb_each(old_data->'rooms')
    LOOP
      -- 插入房间
      INSERT INTO fridge_rooms (code, name, owner_id, members, created_at, updated_at)
      VALUES (
        room_code,
        COALESCE(room_data->>'name', ''),
        COALESCE(room_data->>'ownerId', ''),
        COALESCE(room_data->'members', '[]'::jsonb),
        COALESCE((room_data->>'createdAt')::bigint, 0),
        COALESCE((room_data->>'createdAt')::bigint, 0)
      )
      ON CONFLICT (code) DO NOTHING;

      -- 插入食材
      IF room_data ? 'items' AND room_data->'items' IS NOT NULL THEN
        FOR item_key, item_data IN SELECT * FROM jsonb_each(room_data->'items')
        LOOP
          INSERT INTO fridge_items (id, room_code, name, category, expiry_date, quantity, unit, note, added_by, updated_at, added_at)
          VALUES (
            item_key,
            room_code,
            COALESCE(item_data->>'name', ''),
            COALESCE(item_data->>'category', 'other'),
            COALESCE(item_data->>'expiryDate', ''),
            COALESCE((item_data->>'quantity')::int, 1),
            COALESCE(item_data->>'unit', '份'),
            COALESCE(item_data->>'note', ''),
            COALESCE(item_data->>'addedBy', ''),
            COALESCE((item_data->>'updatedAt')::bigint, 0),
            COALESCE((item_data->>'addedAt')::bigint, 0)
          )
          ON CONFLICT (id) DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
END $$;
