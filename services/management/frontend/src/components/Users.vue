<script setup>
    import UserEditForm from "./UserEditForm.vue";     
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>
<template>
    <h1>Users</h1>
    <table border=1 width="100%">
    <tbody>
    <tr>
        <td>id</td>
        <td>username</td>
        <td>role</td>
        <td colspan=2>
            <button @click="addNewUser">Add new</button>
        </td>
    </tr>
    <tr v-for="user in users">
        <td>{{user.key}}</td>
        <td>{{user.username}}</td>        
        <td>{{ user.role}}</td>
        <td>
            <button @click="editUser(user.key)">Edit</button>
        </td>
        <td>
            <button @click="deleteUser(user.key)" v-if="user.role!='admin'">Delete</button>
        </td>
    </tr>
    </tbody>
    </table>
    <div>
        <UserEditForm 
            v-if="user !== null" 
            :user="user" 
            @close="close"
            @save="saveUser"
        />
    </div>
</template>
<script>
export default {
    name:'Users',
    data(){
        return {
            user:null,
            users:[]
        };

    },
    methods:{
        async getUsers(){
            const data=await this.api.GetUsers();            
            this.users=data.users;
        },

        close(){
            this.user=null;
        },

        async editUser(key){            
            this.user=this.users.filter((u)=>u.key==key)[0];            
        },

        async deleteUser(key){
            if(confirm("To delete user?")){
                await this.api.DeleteUser(key);
                this.getUsers();
            }
 

        },

        async saveUser(user){
            await this.api.SaveUser(user);                     
            this.user=null;
            this.getUsers();
        },

        addNewUser(){
            this.user={
                id:0,
                username:"",
                role:"manager",
                "password":"",
                "password2":""
            };            
        }

    },
    mounted(){
        this.getUsers();

    }


};
</script>