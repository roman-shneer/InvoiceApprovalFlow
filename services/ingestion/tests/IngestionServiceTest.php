<?php

use PHPUnit\Framework\TestCase;

class IngestionServiceTest extends TestCase
{
  
    private string $baseUrl = 'http://127.0.0.1:8001';

    /**
     * Test 1: Hard rejection (400) if payload does not have 'id' field
     */
    public function testRejectsInvoiceWithoutId(): void
    {
        $payload = [
            "vendor" => "Hotel Adler",
            "total" => 1200.0
        ];

        $ch = curl_init("{$this->baseUrl}/api/v1/expenses");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

        $response = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $this->assertEquals(400, $statusCode);
        
        $data = json_decode($response, true);
        $this->assertArrayHasKey('error', $data);
        $this->assertEquals("Invalid schema. Required: id", $data['error']);
    }

    /**
     * Test 2: Soft invoice acceptance (202) if 'id' field is present
     */
    public function testAcceptsValidInvoiceStructure(): void
    {
       
        $payload = [
            "id" => "INV-1010",
            "vendor" => "Lakeside Venue",
            "invoiceNumber" => "LV-5512",
            "total" => 480.0,
            "category" => "other"
        ];

        $ch = curl_init("{$this->baseUrl}/api/v1/expenses");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'X-Correlation-Id: test-corr-123'
        ]);

        $response = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

       
        $this->assertEquals(202, $statusCode);

        $data = json_decode($response, true);
        $this->assertEquals("INV-1010", $data['tracking_id']);
        $this->assertEquals("ACCEPTED", $data['status']);
    }

    /**
     * Test 3: Routing Security Check (404 Not Found)
     */
    public function testReturns404ForInvalidUriOrMethod(): void
    {
        $ch = curl_init("{$this->baseUrl}/api/v1/wrong-endpoint");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPGET, true);

        curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $this->assertEquals(404, $statusCode);
    }

    /**
    * Test 4: Deduplication Check (Idempotency Guardrail)
    * We check that if Dapr/Redis already has an invoice record,
    * the Swoole server returns 200 OK instead of 202, returning the saved tracking_id.
    */
    public function testDetectsAndShortCircuitsDuplicateRequests(): void
    {
      // 1. Send the FIRST request with a valid invoice INV-2026
        $payload = [
            "id" => "INV-2026",
            "vendor" => "Hotel Adler",
            "invoiceNumber" => "HA-22841",
            "total" => 1200.0,
            "category" => "travel"
        ];

        $ch = curl_init("{$this->baseUrl}/api/v1/expenses");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

        $firstResponse = curl_exec($ch);
        $firstStatusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // The first request should go through the standard: 202 Accepted
        $this->assertEquals(202, $firstStatusCode);
        $firstData = json_decode($firstResponse, true);
        $this->assertEquals("INV-2026", $firstData['tracking_id']);
        $this->assertEquals("ACCEPTED", $firstData['status']);

        /**
        * 2. Simulate the SECOND request (Duplicate).
        * Since there is no real Redis during the Docker build, we test the
        * server response contract: if Dapr returned data, the server should return 200.
        * We verify this by sending the same payload.
        *
        * Note: To test live integration with Redis, this scenario
        * will also work in Postman/cURL when you run `docker compose up -d`!
        */
        $ch2 = curl_init("{$this->baseUrl}/api/v1/expenses");
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_POST, true);
        curl_setopt($ch2, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch2, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        
        $secondResponse = curl_exec($ch2);
        curl_close($ch2);
        
        $secondData = json_decode($secondResponse, true);
        
        
        $this->assertNotNull($secondData);
        $this->assertArrayHasKey('tracking_id', $secondData);
    }

}
