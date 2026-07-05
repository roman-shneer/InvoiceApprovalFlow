<script setup>
import { ref, onMounted } from "vue";
import Users from "./Users.vue";
import Families from "./Families.vue";
import Policies from "./Policies.vue";
import InvoiceForm from './InvoiceForm.vue';
import Api from "./../resources/api.js";
import Invoices from './Invoices.vue';
const api = new Api();

const isAuthenticated = ref(false);
const user = ref(null);
const page = ref("policies");

const loginForm = ref({
  username: "",
  password: "",
});

const usernameChanged = (evt) => {
  loginForm.value.username = evt.target.value.trim();
};

const passwordChanged = (evt) => {
  loginForm.value.password = evt.target.value.trim();
};

const checkToken = async () => {
  try {
    const data = await api.CheckAuth();

    if (data && data.Success) {
      user.value = data.user;
      isAuthenticated.value = true;
      await api.connectWebSocket();
    } 
  } catch (error) {
    console.error("Error checking auth:", error);
  }
};

const sendLoginForm = async () => {
  try {
    const result = await api.SendLogin(loginForm.value);  
    if (result && result.success) {  
      user.value = result.user;
      isAuthenticated.value = true;
      await api.connectWebSocket();
    } else {
      alert("Invalid username or password");
    }
  } catch (error) {
    console.error("Error then sending request:", error);
  }
};

const logOut =  async () => {
  api.LogOut();
  isAuthenticated.value = false;
};

onMounted(() => {
  checkToken();
});
</script>

<template>
  <section>
    <div v-if="isAuthenticated == false">
      <h1>Please login</h1>
      <div>
        <input type="text" @input="usernameChanged" placeholder="Username" />
      </div>
      <div>
        <input type="password" @input="passwordChanged" placeholder="Password" />
      </div>
      <div>
        <input type="submit" value="Login" @click="sendLoginForm" />
      </div>
    </div>

    <div v-if="isAuthenticated">
      <div class="main-div">
        <div class="menu-div">
          <div style="border:solid black 1px;padding:0;margin-bottom:20px;">
            {{ user.username }}
            <button class="menu-btn" @click="logOut">LogOut</button>
          </div>
          <button class="menu-btn" @click="page = 'policies'" v-if="user.role=='admin'">Policies</button>
          <button class="menu-btn" @click="page = 'users'" v-if="user.role=='admin'">Users</button>
        </div>
        <div class="content-div">       
          <InvoiceForm v-if="user.role=='submitter'" :api="api" ></InvoiceForm>  
          <Invoices  v-if="user.role=='submitter'||user.role=='approver'" :api="api" :role="user.role"></Invoices>
          <Policies v-if="page == 'policies' && user.role=='admin'" :api="api"></Policies>
          <Users v-if="page == 'users' && user.role=='admin'" :api="api"></Users>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.menu-div {
  border: solid #ccc 1px;
  padding: 10px;
  width: 10%;
}
.menu-btn {
  display: block;
  margin-bottom: 15px;
  width: 100%;
}
.main-div {
  border: solid #ccc 1px;
  display: flex;
  width: 100%;
}
.content-div {
  border: solid #ccc 1px;
  width: 100%;
}
</style>
