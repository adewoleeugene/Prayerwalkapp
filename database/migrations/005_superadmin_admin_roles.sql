-- Differentiate global overseer and branch pastor roles.
-- superadmin => sees all branches
-- admin => restricted to assigned branch

ALTER TABLE users
ADD COLUMN IF NOT EXISTS branch VARCHAR(100);

-- Normalize legacy role naming to the new role set.
UPDATE users
SET role = 'admin'
WHERE role = 'pastor';
