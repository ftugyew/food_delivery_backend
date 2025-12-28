const { ORDER_STATUS, TRACKING_STATUS } = require('../constants/statuses');

class AssignmentError extends Error {
  constructor(message, statusCode = 400, code = 'ASSIGNMENT_ERROR') {
    super(message);
    this.name = 'AssignmentError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const ORDER_SELECT_SQL = `SELECT o.*, r.name as restaurant_name, r.lat as restaurant_lat, r.lng as restaurant_lng
FROM orders o
LEFT JOIN restaurants r ON o.restaurant_id = r.id
WHERE o.id = ? LIMIT 1`;

async function assignAgentToOrder({ db, orderId, agentId }) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [agentRows] = await connection.execute(
      'SELECT id, name, is_online, is_busy FROM agents WHERE id = ? FOR UPDATE',
      [agentId]
    );

    if (!agentRows || agentRows.length === 0) {
      throw new AssignmentError('Agent not found', 404, 'AGENT_NOT_FOUND');
    }

    const agent = agentRows[0];

    if (!agent.is_online) {
      throw new AssignmentError('Agent is offline', 403, 'AGENT_OFFLINE');
    }

    if (agent.is_busy) {
      throw new AssignmentError('Agent already has an active order', 409, 'AGENT_BUSY');
    }

    const [orderRows] = await connection.execute(
      'SELECT id, status, agent_id FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );

    if (!orderRows || orderRows.length === 0) {
      throw new AssignmentError('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    const order = orderRows[0];

    if (order.agent_id && Number(order.agent_id) !== Number(agentId)) {
      throw new AssignmentError('Order already assigned to another agent', 409, 'ORDER_TAKEN');
    }

    if (order.status !== ORDER_STATUS.WAITING_AGENT) {
      throw new AssignmentError(`Order status must be '${ORDER_STATUS.WAITING_AGENT}'`, 409, 'ORDER_NOT_WAITING');
    }

    await connection.execute('UPDATE agents SET is_busy = 1 WHERE id = ?', [agentId]);

    await connection.execute(
      `UPDATE orders
       SET agent_id = ?,
           status = '${ORDER_STATUS.AGENT_ASSIGNED}',
           tracking_status = '${TRACKING_STATUS.ACCEPTED}'
       WHERE id = ?`,
      [agentId, orderId]
    );

    const [orderDetails] = await connection.execute(ORDER_SELECT_SQL, [orderId]);
    await connection.commit();

    return {
      order: orderDetails[0] || order,
      agent,
    };
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackErr) {
      // ignore rollback errors
    }
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  assignAgentToOrder,
  AssignmentError,
};
