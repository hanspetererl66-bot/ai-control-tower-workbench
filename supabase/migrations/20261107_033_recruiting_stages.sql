-- Recruiting (033): the three interview rounds become real stages.
-- Before: Applied, Screening, Interview, Offer (the round was only a tag in the sample).
-- After:  Applied, Screening, Online interview, In-person interview, Final conversation, Offer.
-- Candidates that stood in "Interview" move to "Online interview" (the first round) unless the sample names the round:
-- C-4101 -> Final conversation, C-4303 and C-4304 -> In-person interview. Re-running changes nothing.

-- 1. Allow the new stage names (the check was created inline, so it carries the default name).
alter table recruiting.stage_target drop constraint if exists stage_target_stage_check;
alter table recruiting.stage_target add constraint stage_target_stage_check
  check (stage in ('Applied', 'Screening', 'Online interview', 'In-person interview', 'Final conversation', 'Offer', 'Interview'));

-- 2. Make room in the unique order column, then insert the new rows.
update recruiting.stage_target set ord = ord + 10 where stage in ('Interview', 'Offer') and ord < 10;
insert into recruiting.stage_target (stage, days, ord) values
  ('Online interview', 7, 3), ('In-person interview', 7, 4), ('Final conversation', 5, 5)
on conflict (stage) do nothing;
update recruiting.stage_target set ord = 6 where stage = 'Offer';

-- 3. Move the people. Only the three known sample candidates get a later round; every other "Interview" becomes the first round.
update recruiting.candidate set stage = 'Final conversation' where stage = 'Interview' and id = 'C-4101';
update recruiting.candidate set stage = 'In-person interview' where stage = 'Interview' and id in ('C-4303', 'C-4304');
update recruiting.candidate set stage = 'Online interview' where stage = 'Interview';

-- 4. Retire the old stage and tighten the check again.
delete from recruiting.stage_target where stage = 'Interview';
alter table recruiting.stage_target drop constraint if exists stage_target_stage_check;
alter table recruiting.stage_target add constraint stage_target_stage_check
  check (stage in ('Applied', 'Screening', 'Online interview', 'In-person interview', 'Final conversation', 'Offer'));
