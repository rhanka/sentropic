CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  size TEXT,
  products TEXT,
  processes TEXT,
  challenges TEXT,
  objectives TEXT,
  technologies TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  company_id TEXT REFERENCES companies(id),
  matrix_config TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS use_cases (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  process TEXT,
  technology TEXT,
  deadline TEXT,
  contact TEXT,
  benefits TEXT,
  metrics TEXT,
  risks TEXT,
  next_steps TEXT,
  sources TEXT,
  related_data TEXT,
  value_scores TEXT,
  complexity_scores TEXT,
  total_value_score INTEGER,
  total_complexity_score INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  openai_models TEXT,
  prompts TEXT,
  generation_limits TEXT
);

CREATE TABLE IF NOT EXISTS business_config (
  id TEXT PRIMARY KEY,
  sectors TEXT,
  processes TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT,
  profile TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT
);
