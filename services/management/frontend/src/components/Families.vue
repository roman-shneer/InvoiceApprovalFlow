<script setup>
const props = defineProps({
  api: {
    type: Object,
    required: true
  }
});
</script>
<template>
    <h1>Families</h1>
    <select>
      <option v-for="category in categories">{{category.Name}}</option>
    </select>
</template>
<script>
export default {
    name:'Settings',
    data(){
      return {
        categories:[]
      };

    },
    methods:{
      loadFamilies(){
        this.categories=this.api.GetCategories();
      }
    },
    mounted(){
      this.loadFamilies();
    }
}
</script>