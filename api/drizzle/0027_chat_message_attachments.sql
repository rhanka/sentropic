-- Migration 0027: BR-38a chat message attachments
-- Adds a nullable JSONB contract for media/document references attached to chat messages.

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "attachments" jsonb;
