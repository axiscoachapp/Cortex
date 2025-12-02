-- Add clinical_notes field to patients table
ALTER TABLE public.patients 
ADD COLUMN clinical_notes TEXT DEFAULT '';

-- Add ai_insights field to store AI-processed information
ALTER TABLE public.patients 
ADD COLUMN ai_insights JSONB DEFAULT '{}'::jsonb;