<template>
    <div id="edit-form-container">        
        <button @click="$emit('close')" class="close-btn">x</button>
        <div v-if="error!=null" class="color:red">
            
        </div>
        <table id="edit-form">
            <caption>
            {{error}}
            </caption>
            <tbody>
                <tr>
                    <td>id</td>                    
                    <td>{{ user ? user.key : '' }}</td> 
                </tr>
                <tr>
                    <td>username</td>
                    <td>                        
                        <input type="text" v-model="myUser.username"/>
                    </td>
                </tr>
                <tr>
                    <td>role</td>
                    <td>                        
                        <select v-model="myUser.role">
                            <option>admin</option>
                            <option>approver</option>
                            <option>submitter</option>
                        </select>
                    </td>
                </tr>
                <tr>
                    <td>password</td>
                    <td>
                        <input type="password" v-model="myUser.password"/>
                    </td>
                </tr>
                <tr>
                    <td>retype password</td>
                    <td>
                        <input type="password" v-model="myUser.password2"/>
                    </td>
                </tr>
                <tr>
                    <td colspan="2">
                        <button @click="save">Save</button>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script>
export default {
    name: "UserEditForm",
    props: ["user"],
    emits: ["close", "save"], 
    data() {
      
        return {
            error:null,
            myUser: {
                key:this.user.key,
                username: this.user.username,
                role: this.user.role,
                password: '',
                password2: ''
            }
        };
    },
    watch: {
        user: {
            handler(newUser) {
                if (newUser) {                   
                    this.myUser = JSON.parse(JSON.stringify(newUser));
                }
            },
            immediate: true,
            deep: true
        }
    },
    methods: {
        save() {            
            if(this.myUser.password!="" && this.myUser.password!=this.myUser.password2){
                this.error="Passwords should be equal";
                return;
            }
            if(this.myUser.username.trim()==""){
                this.error="Please write username";
                return;
            }
            if(!this.myUser.key && this.myUser.password.trim()=="" && this.myUser.password2.trim()==""){
                this.error="You try create user without password";
                return;
            }
            this.$emit('save', this.myUser);
        }
    }
};
</script>

<style scoped>
#edit-form {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%); 
    border: solid black;
    background: white;
    padding: 20px; 
    z-index: 1000;
}
#edit-form td {
    text-align: left;
}
.close-btn {
    position: fixed;
    top: calc(50% - 140px); 
    left: calc(50% + 130px);
    z-index: 1001;
    cursor: pointer;
}
</style>
