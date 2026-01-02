const ORDER_STATUS = {
  PENDING: 'Pending',
  WAITING_AGENT: 'waiting_for_agent',
  AGENT_ASSIGNED: 'agent_assigned',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  PICKED_UP: 'Picked Up',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled'
};

const TRACKING_STATUS = {
  WAITING: 'waiting',
  PENDING: 'waiting',
  ACCEPTED: 'accepted',
  AGENT_ASSIGNED: 'agent_assigned',
  GOING_TO_RESTAURANT: 'agent_going_to_restaurant',
  ARRIVED: 'arrived_at_restaurant',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
};

const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);
const TRACKING_STATUS_VALUES = Object.values(TRACKING_STATUS);

module.exports = {
  ORDER_STATUS,
  TRACKING_STATUS,
  ORDER_STATUS_VALUES,
  TRACKING_STATUS_VALUES
};
