/**
 * Helpers that produce the API envelope described in the API contract.
 */
function sendData(res, data, { status = 200, message = 'Operation completed successfully.' } = {}) {
  return res.status(status).json({ success: true, data, message });
}

function sendCreated(res, data, message = 'Created successfully.') {
  return sendData(res, data, { status: 201, message });
}

function sendPage(res, { rows, total, page, limit }, extra = {}) {
  return res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    ...extra,
  });
}

module.exports = { sendData, sendCreated, sendPage };
