<script setup>
import PolicyForm from "./PolicyForm.vue";
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>
<template>
    <h1>Policies</h1>
    <PolicyForm v-if="policyToEdit!=null" :policyToEdit="policyToEdit" @close="onClose" @save="onSave" @delete="onDelete"></PolicyForm>
    <button @click="addNew">Add new</button>
    <table border=1 width="100%">
        <tbody>
            <tr>
                <td>RuleId</td>
                <td>Category</td>
                <td>Rule</td>
                <td>Created</td>
                <td>Status</td>
                <td>&nbsp;</td>
            </tr>
            <tr v-for="policy in policies">                
                <td>{{ policy.rule_id}}</td> 
                <td>{{ policy.category}}</td>
                <td>{{ policy.rule_text}}</td>
                <td>{{ renderDate(policy.created_at) }}</td>
                <td>{{ policy.is_active?"Enabled":"Disabled" }}</td>
                <td>
                    <button @click="editPolicy(policy)">edit</button>
                </td>
            </tr>
        </tbody>
    </table>
   
</template>
<script>
import { toRaw } from 'vue';
export default {
    name:'Policies',
    data(){
        return {
            policyToEdit:null,
            policies:[]
        };        
    },
    methods:{
        renderDate(d){
            d=toRaw(d);        
            const isoDateStr= d.$date.toLocaleString();
            const humanDate = new Date(isoDateStr).toLocaleString();
            return humanDate;
        },
        addNew(){
                this.policyToEdit={               
                    category:'',
                    rule_id:'',
                    rule_text:'',
                    is_active:false
                };
        },
        editPolicy(policy){
            this.policyToEdit=policy;
        },
        async onSave(){
            if(this.policyToEdit.rule_id.trim()==''){
                alert("RuleId cannot be empty");
                return;
            }
            if(this.policyToEdit.category.trim()==''){
                alert("Category cannot be empty");
                return;
            }
            if(this.policyToEdit.rule_text.trim()==''){
                alert("Rule  cannot be empty");
                return;
            }
            await this.api.SavePolicy(this.policyToEdit);           
            this.policyToEdit=null;
            this.loadPolicies();

        },
        onClose(){
            this.policyToEdit=null;
        },

        async onDelete(){
            if(confirm("Sure?")){
                await this.api.DeletePolicy(this.policyToEdit.rule_id);           
                this.policyToEdit=null;
                this.loadPolicies();
            }
        },
        async loadPolicies(){
            const data = await this.api.GetPolicies();                      
            this.policies= data.policies;
            
        }
        
    },
    mounted(){
        this.loadPolicies();
    }
}
</script>
<style scoped>
   table{

    border-collapse: collapse;
   }
   td{
    text-align: left;
   }
</style>