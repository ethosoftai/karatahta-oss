alter table lessons
  add column if not exists orientation text not null default 'horizontal';

alter table lessons
  drop constraint if exists lessons_orientation_check;

alter table lessons
  add constraint lessons_orientation_check
  check (orientation in ('horizontal', 'vertical'));
