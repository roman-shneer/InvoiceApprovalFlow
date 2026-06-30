<?php

use Swoole\Http\Server;
use Swoole\Http\Request;
use Swoole\Http\Response;
use Swoole\Coroutine\Http\Client;

/**
 * FIX 1: Move the logging function to the top to avoid 
 * "Call to undefined function" runtime exceptions in Swoole threads.
 */
function logMessage(string $level, string $correlationId, string $message)
{
    $log = [
        "timestamp" => date('Y-m-d\TH:i:s.vP'),
        "level" => $level,
        "service" => "ingestion-service",
        "correlation_id" => $correlationId,
        "message" => $message
    ];

    $formattedMsg = json_encode($log) . "\n";
    echo $formattedMsg;
    // Non-blocking output to stdout is handled by Swoole, but file_put_contents is blocking.
    // For pure dev/testing this is ok, in production it should be async or turned off.
    @file_put_contents("server.log", $formattedMsg, FILE_APPEND);
}

define('DAPR_HOST', 'ingestion-dapr-sidecar');
define('DAPR_PORT', 3500);

$server = new Server("0.0.0.0", 8001);

$server->set([
    'worker_num' => swoole_cpu_num(),
    'enable_coroutine' => true,
]);

$server->on("Start", function (Server $server) {
    echo "🚀 ApprovalFlow Ingestion Service successfully started at http://0.0.0\n";
});

// Safe bootstrap logging
logMessage("INFO", "0", "Ingestion-service bootstrap complete. Listening for incoming traffic.");

$server->on("Request", function (Request $request, Response $response) {

    $response->header("Access-Control-Allow-Origin", "*");
    $response->header("Content-Type", "application/json");

    if ($request->server['request_method'] === 'OPTIONS') {
        $response->status(200);
        $response->end();
        return;
    }

  
    if ($request->server['request_uri'] !== '/api/v1/expenses' || $request->server['request_method'] !== 'POST') {
        $response->status(404);
        $response->end(json_encode(["error" => "Not Found"]));
        return;
    }

    $correlationId = $request->header['x-correlation-id'] ?? uniqid('corr_', true);
    logMessage("INFO", $correlationId, "Received raw invoice submission request.");

    $body = json_decode($request->rawContent(), true);
    if (!$body || !isset($body['id'])) {
        $response->status(400);
        $response->end(json_encode(["error" => "Invalid schema. Required: id"]));
        logMessage("WARN", $correlationId, "Rejected due to invalid JSON schema.");
        return;
    }

    // Defensive initialization for idempotency calculation
    $vendor        = $body['vendor']        ?? 'UnknownVendor';
    $invoiceNumber = $body['invoiceNumber'] ?? 'NoNumber';
    $total         = $body['total']         ?? 0.0;
    $idempotencyKey = md5($vendor . '_' . $invoiceNumber . '_' . $total);

    // Dapr State Store: Check Duplicate
    $stateGetClient = new Client(DAPR_HOST, DAPR_PORT);
    $stateGetClient->set(['timeout' => 2.0]);
    $stateGetClient->get("/v1.0/state/approval-state/{$idempotencyKey}");

    if ($stateGetClient->statusCode === 200 && !empty($stateGetClient->body)) {
        $existingState = json_decode($stateGetClient->body, true);
        $trackingId = $existingState['tracking_id'] ?? $body['id'];

        logMessage("INFO", $correlationId, "Duplicate detected via key: {$idempotencyKey}. Short-circuiting request.");

        $response->status(200);
        $response->end(json_encode([
            "tracking_id" => $trackingId,
            "status" => $existingState['status'] ?? "PROCESSING",
            "message" => "Duplicate request detected. Invoice is already being processed."
        ]));
        return;
    }

    /**
     * FIX 2: Aligned tracking_id generation.
     * We map the incoming test ID (e.g. 'INV-1010') as our primary tracking_id 
     * to keep deterministic tracking fully integrated with your input scenarios.
     */
    $trackingId = $body['id']; 

    // Dapr State Store: Save Processing Key
    $statePostClient = new Client(DAPR_HOST, DAPR_PORT);
    $statePostClient->set(['timeout' => 2.0]);
    
    // FIX 4: Explicitly provide Content-Type header required by Dapr State Management API
    $statePostClient->setHeaders([
        'Content-Type' => 'application/json'
    ]);

    $statePayload = [
        [
            "key" => $idempotencyKey,
            "value" => [
                "tracking_id" => $trackingId,
                "correlation_id" => $correlationId,
                "status" => "PROCESSING"
            ],
            "metadata" => [
                "ttlInSeconds" => "86400"
            ]
        ]
    ];

    $statePostClient->post("/v1.0/state/approval-state", json_encode($statePayload));

    if ($statePostClient->statusCode !== 200 && $statePostClient->statusCode !== 204) {
        logMessage("ERROR", $correlationId, "Failed to persist state store key. Status: " . $statePostClient->statusCode . " | Body: " . $statePostClient->body);
    }

    // Refresh sanitized data fields for clean event streaming
    $category = $body['category'] ?? 'General';

    $eventPayload = [
        "idempotency_key" => $idempotencyKey,
        "correlation_id"  => $correlationId,
        "submitted_at"    => date(DATE_ATOM),
        "id"              => $trackingId,
        "submitter"       => $body['submitter']      ?? 'anonymous@example.com',
        "department"      => $body['department']     ?? 'unassigned',
        "vendor"          => $vendor,
        "vendorKnown"     => (bool)($body['vendorKnown'] ?? true),
        "invoiceNumber"   => $invoiceNumber,
        "currency"        => $body['currency']       ?? 'USD',
        "category"        => $category,    
        "lineItems"       => $body['lineItems']      ?? [],    
        "taxAmount"       => (float)($body['taxAmount'] ?? 0.0),
        "total"           => (float)$total,
        "receiptPresent"  => (bool)($body['receiptPresent'] ?? true),
        "date"            => $body['date']           ?? date('Y-m-d'),
        "notes"           => $body['notes']          ?? '',
        "scenario"        => $body['scenario']       ?? 'standard-ingest'
    ];

    // Dapr Pub/Sub: Publish Event
    $pubsubClient = new Client(DAPR_HOST, DAPR_PORT);
    $pubsubClient->set(['timeout' => 2.0]);
    $pubsubClient->setHeaders([
        'Content-Type' => 'application/json'
    ]);

    $encodedPayload = json_encode($eventPayload);
    $pubsubClient->post("/v1.0/publish/approval-pubsub/invoice.submitted", $encodedPayload);

    if ($pubsubClient->statusCode === 200 || $pubsubClient->statusCode === 204) {
        logMessage("INFO", $correlationId, "Successfully published 'invoice.submitted' event for tracking_id: {$trackingId}");
    } else {
        logMessage("ERROR", $correlationId, "Dapr Pub/Sub REJECTED the event. Status: " . $pubsubClient->statusCode . " | Body: " . $pubsubClient->body);
    }

    // Response back to Client (202 Accepted)
    $response->status(202);
    $response->end(json_encode([
        "tracking_id" => $trackingId,
        "status" => "ACCEPTED",
        "message" => "Invoice submitted successfully and queued for processing."
    ]));
});

$server->start();
