-- Migration 0028: BR-38a chat message attachments (renumbered from 0027 on merge with main's 0027_oauth_clients)
-- Adds a nullable JSONB contract for media/document references attached to chat messages.

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachments" jsonb;
