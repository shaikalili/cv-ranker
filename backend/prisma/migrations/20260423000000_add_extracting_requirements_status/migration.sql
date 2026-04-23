-- AddEnumValue: add EXTRACTING_REQUIREMENTS between CREATED and REQUIREMENTS_EXTRACTED
-- so clients can distinguish "row exists, nothing happening yet" from "AI call in
-- flight". Safe, non-breaking: existing rows keep their current value.
ALTER TYPE "JobPositionStatus" ADD VALUE 'EXTRACTING_REQUIREMENTS' BEFORE 'REQUIREMENTS_EXTRACTED';
