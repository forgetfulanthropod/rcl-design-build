-- Personas: owner, admin, lead, labor, sub (superadmin = Elvira, owner + code approval).
update profiles set role = 'admin' where role in ('pm', 'office');
update profiles set role = 'lead' where role = 'superintendent';
update profiles set role = 'labor' where role = 'field';
update profiles set role = 'sub' where role = 'subcontractor';
update magic_links set role = 'admin' where role in ('pm', 'office');
update magic_links set role = 'lead' where role = 'superintendent';
update magic_links set role = 'labor' where role = 'field';
update magic_links set role = 'sub' where role = 'subcontractor';
