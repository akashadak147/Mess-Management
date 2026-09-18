const EventEmitter = require('events');

class PortalEventBus extends EventEmitter {}

const eventBus = new PortalEventBus();
// Allow multiple simultaneous listeners without MaxListenersExceeded warning
eventBus.setMaxListeners(100);

module.exports = eventBus;
