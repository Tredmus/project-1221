-- Imperium — Migration 017: map editor reference image (Storage + settings row)
--
-- Private bucket for the cartography underlay; path + alignment live in
-- map_editor_settings (singleton id = 1). Only the service role touches
-- these — the Next admin routes use createAdminSupabase().

CREATE TABLE public.map_editor_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reference_storage_path text,
  reference_pan_x numeric NOT NULL DEFAULT 0,
  reference_pan_y numeric NOT NULL DEFAULT 0,
  reference_scale numeric NOT NULL DEFAULT 1,
  reference_opacity numeric NOT NULL DEFAULT 0.38,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT map_editor_settings_scale_positive CHECK (reference_scale > 0),
  CONSTRAINT map_editor_settings_opacity_range CHECK (
    reference_opacity >= 0 AND reference_opacity <= 1
  )
);

COMMENT ON TABLE public.map_editor_settings IS
  'Singleton (id=1): map editor reference chart path in Storage + SVG alignment.';

INSERT INTO public.map_editor_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.map_editor_settings ENABLE ROW LEVEL SECURITY;

-- No policies: only service_role bypasses RLS; JWT roles cannot read/write.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'map-editor-reference',
  'map-editor-reference',
  false,
  104857600,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
