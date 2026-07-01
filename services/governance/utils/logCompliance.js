

function logCompliance(level, trackingId, correlationId, message) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: level,
        service: "governance-service-node",
        correlation_id: correlationId || "unknown",
        message: `[${trackingId || 'N/A'}] ${message}`
    }));
}
module.exports = { logCompliance };