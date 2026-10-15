const { query } = require('../../database/db');

async function medicines(like, term) {
  const { rows } = await query(
    `SELECT id, name AS title, concat_ws(' · ', strength, dosage_form, package_size) AS subtitle, status
       FROM medicines WHERE name ILIKE $1 OR generic_name ILIKE $1 OR brand_name ILIKE $1 OR barcode = $2
      ORDER BY (status = 'ACTIVE') DESC, name LIMIT 5`,
    [like, term],
  );
  return rows;
}

async function sales(like, branchIds, soldBy) {
  const { rows } = await query(
    `SELECT s.id, s.receipt_number AS title, concat(b.name, ' · ', s.total) AS subtitle, s.status
       FROM sales s JOIN branches b ON b.id = s.branch_id
      WHERE s.receipt_number ILIKE $1
        AND ($2::uuid[] IS NULL OR s.branch_id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR s.sold_by = $3)
      ORDER BY s.completed_at DESC LIMIT 5`,
    [like, branchIds, soldBy],
  );
  return rows;
}

async function suppliers(like) {
  const { rows } = await query(
    `SELECT id, company_name AS title, phone AS subtitle, status FROM suppliers
      WHERE deleted_at IS NULL AND (company_name ILIKE $1 OR contact_person ILIKE $1 OR phone ILIKE $1)
      ORDER BY company_name LIMIT 5`,
    [like],
  );
  return rows;
}

async function purchases(like, branchIds) {
  const { rows } = await query(
    `SELECT p.id, p.purchase_number AS title, s.company_name AS subtitle, p.status
       FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.purchase_number ILIKE $1 AND ($2::uuid[] IS NULL OR p.branch_id = ANY($2::uuid[]))
      ORDER BY p.created_at DESC LIMIT 5`,
    [like, branchIds],
  );
  return rows;
}

async function transfers(like, branchIds) {
  const { rows } = await query(
    `SELECT t.id, t.transfer_number AS title, concat(sb.code, ' → ', db.code) AS subtitle, t.status
       FROM transfers t JOIN branches sb ON sb.id = t.source_branch_id JOIN branches db ON db.id = t.destination_branch_id
      WHERE t.transfer_number ILIKE $1
        AND ($2::uuid[] IS NULL OR t.source_branch_id = ANY($2::uuid[]) OR t.destination_branch_id = ANY($2::uuid[]))
      ORDER BY t.created_at DESC LIMIT 5`,
    [like, branchIds],
  );
  return rows;
}

async function staff(like, visibleBranchIds) {
  const { rows } = await query(
    `SELECT u.id, u.full_name AS title, concat(r.name, ' · ', u.email) AS subtitle, u.status
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.deleted_at IS NULL AND (u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.employee_id ILIKE $1)
        AND ($2::uuid[] IS NULL OR r.code = 'OWNER' OR EXISTS (
              SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = ANY($2::uuid[])))
      ORDER BY u.full_name LIMIT 5`,
    [like, visibleBranchIds],
  );
  return rows;
}

module.exports = { medicines, sales, suppliers, purchases, transfers, staff };
