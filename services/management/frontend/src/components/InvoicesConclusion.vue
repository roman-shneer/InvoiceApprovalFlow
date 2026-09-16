<template>
    <hr/>
    <div>Correct invoices: {{ correctCount }} from  {{ processedCount }} {{ resultPercentage }}</div>
</template>
<script>
export default {
    name:'InvoicesConclusion',
    props:['correctCount','processedCount','resultPercentage'],    
}
</script>