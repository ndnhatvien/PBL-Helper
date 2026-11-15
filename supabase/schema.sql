-- ==============================================================================
-- PBL-Helper: Supabase Database Schema
-- Chạy script này trong SQL Editor trên Supabase Dashboard (https://supabase.com)
-- ==============================================================================

-- 1. Bảng hồ sơ người dùng (Profiles) gắn liền với Supabase Auth
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('coordinator', 'advisor', 'grader', 'guest')),
  lecturer_name TEXT, -- Tên hiển thị khớp với tên giảng viên trong bảng điểm (dành cho GVHD)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bật Row Level Security (RLS) cho profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Chính sách RLS cho profiles: Người dùng đăng nhập có thể xem profiles
CREATE POLICY "Mọi người dùng đã đăng nhập đều xem được profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Chính sách: Người dùng tự cập nhật hồ sơ cá nhân hoặc Admin cập nhật vai trò
CREATE POLICY "Người dùng tự cập nhật hồ sơ cá nhân hoặc Admin duyệt quyền"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'coordinator'
    )
  );

-- Trigger tự động tạo profile khi người dùng mới đăng ký qua Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  assigned_role TEXT;
BEGIN
  -- QUY TẮC PHÂN QUYỀN DUT:
  -- Chỉ email đuôi @dut.udn.vn mới được cấp vai trò giảng viên / điều phối viên.
  -- Tất cả các domain khác (gmail, yahoo...) đều ở vai trò 'guest' chờ Admin duyệt.
  IF NEW.email ILIKE '%@dut.udn.vn' THEN
    assigned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'advisor');
  ELSE
    assigned_role := 'guest';
  END IF;

  INSERT INTO public.profiles (id, email, display_name, role, lecturer_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    assigned_role,
    COALESCE(NEW.raw_user_meta_data->>'lecturer_name', NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ==============================================================================
-- 2. Bảng quản lý đợt thi & dữ liệu toàn diện (pbl_batches)
-- Lưu trữ cấu trúc đợt thi và toàn bộ dữ liệu nghiệp vụ (students, groups, scores, reviews)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.pbl_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  term TEXT,
  exam_date TEXT,
  note TEXT,
  score_config JSONB NOT NULL DEFAULT '{"min": 0, "max": 10, "decimals": 1}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- Chứa sourceWorkbooks, students, groups, members, lecturers, scores, reviews, changeLogs...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index tăng tốc truy vấn theo ngày tạo và người tạo
CREATE INDEX IF NOT EXISTS idx_pbl_batches_updated_at ON public.pbl_batches(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pbl_batches_created_by ON public.pbl_batches(created_by);

-- Bật RLS cho pbl_batches
ALTER TABLE public.pbl_batches ENABLE ROW LEVEL SECURITY;

-- Chính sách RLS cho pbl_batches:
-- Người dùng đã đăng nhập có thể đọc các đợt thi
CREATE POLICY "Người dùng đăng nhập có thể xem đợt thi"
  ON public.pbl_batches FOR SELECT
  TO authenticated
  USING (true);

-- Điều phối viên (hoặc người tạo) có thể thêm mới đợt thi
CREATE POLICY "Người dùng đăng nhập có thể tạo đợt thi"
  ON public.pbl_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Người dùng đăng nhập có thể cập nhật đợt thi
CREATE POLICY "Người dùng đăng nhập có thể cập nhật đợt thi"
  ON public.pbl_batches FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Người dùng đăng nhập có thể xóa đợt thi mình tạo (hoặc coordinator)
CREATE POLICY "Người tạo hoặc Coordinator có thể xóa đợt thi"
  ON public.pbl_batches FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'coordinator'
    )
  );

-- Kích hoạt Realtime cho bảng pbl_batches để đồng bộ tức thời giữa các giảng viên
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'pbl_batches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pbl_batches;
  END IF;
END $$;

-- ==============================================================================
-- 3. Khởi tạo tài khoản Quản trị viên mặc định (Admin DUT)
-- Email: admin@dut.udn.vn | Mật khẩu: DHBK@54nlb
-- ==============================================================================

DO $$
DECLARE
  admin_uid UUID := 'a0000000-0000-0000-0000-000000000001'::uuid;
BEGIN
  -- Tạo user trong auth.users nếu chưa có
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@dut.udn.vn') THEN
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token
    ) VALUES (
      admin_uid,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'admin@dut.udn.vn',
      crypt('DHBK@54nlb', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Quản trị viên (Admin - DUT)","role":"coordinator","lecturer_name":"Admin"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated',
      ''
    );
  END IF;

  -- Đảm bảo profile có quyền coordinator
  INSERT INTO public.profiles (id, email, display_name, role, lecturer_name)
  SELECT id, email, 'Quản trị viên (Admin - DUT)', 'coordinator', 'Admin'
  FROM auth.users
  WHERE email = 'admin@dut.udn.vn'
  ON CONFLICT (id) DO UPDATE SET
    role = 'coordinator',
    display_name = 'Quản trị viên (Admin - DUT)';
END $$;
