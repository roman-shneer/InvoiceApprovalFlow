<script setup>
    const emit = defineEmits(['save', 'close','delete'])

</script>
<template>
    <div class="form">
        <div class="top-panel">
            <button @click="$emit('close')">x</button>
        </div>
        <h2>Edit Policy</h2>
        <table>
            <tbody>           
                <tr>
                    <td>RuleId</td>
                    <td><input type="text" v-model="policyToEdit.rule_id"></td>
                </tr>     
                <tr>
                    <td>Category</td>
                    <td><input type="text" v-model="policyToEdit.category"></td>
                </tr>
                <tr>
                    <td>Rule</td>
                    <td><textarea v-model="policyToEdit.rule_text"></textarea></td>
                </tr>
                <tr>
                    <td>Status</td>
                    <td><input type="checkbox" v-model="policyToEdit.is_active"/></td>
                </tr>
                <tr>
                    <td>
                        <button @click="$emit('save')">Save</button>
                    </td>
                    <td>
                        <button  @click="$emit('delete')">Delete</button>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

</template>
<script>
export default {
    name:'Policies',
    props:['policyToEdit'],
};
</script>
<style scoped>
.form{
    border:solid black 1px;
    position: absolute;
    background: white;
    padding:10px;
    margin-left:5%;
    width:40%;
}
.top-panel{
    text-align: right;
}
table{
    border-collapse: collapse;
}
td{
    text-align: left;
}
</style>