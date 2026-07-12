const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'fixtures.csv');
const TOTAL_INVOICES = 1000000;


const headers = 'id,submitter,department,vendor,vendorKnown,invoiceNumber,currency,category,attendees,lineItems,taxAmount,total,receiptPresent,date,notes\n';

console.log(`🚀 Generating ${TOTAL_INVOICES.toLocaleString()} records into CSV...`);

const writeStream = fs.createWriteStream(OUTPUT_FILE, { encoding: 'utf8' });
writeStream.write(headers);

let i = 0;

function writeNextChunk() {
    let ok = true;
    while (i < TOTAL_INVOICES && ok) {
        const id = `INV-${1001 + i}`;
        const invoiceNumber = `NW-INV-${7781 + i}`;


        const lineItemsStr = JSON.stringify([{ "description": "Team lunch", "quantity": 1, "unitPrice": 38.89 }]).replace(/"/g, '""');


        const row = `${id},"dana.cohen@northwind.example","engineering-2026Q2","Bistro 19",true,${invoiceNumber},USD,meals,1,"${lineItemsStr}",3.11,42.0,true,"2026-05-12","Solo working lunch."\n`;

        ok = writeStream.write(row);
        i++;
    }

    if (i < TOTAL_INVOICES) {
        writeStream.once('drain', writeNextChunk);
    } else {
        writeStream.end();
        console.log(`✅ Success! Created: ${OUTPUT_FILE}`);
    }
}

writeNextChunk();
