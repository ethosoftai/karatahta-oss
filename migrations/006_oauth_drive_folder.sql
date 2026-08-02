-- Remembers the Drive folder created for a user's lesson uploads, so
-- every save-to-drive call after the first reuses the same folder
-- instead of creating a new one (or re-searching for it) each time.
alter table oauth_connections add column if not exists drive_folder_id text;
