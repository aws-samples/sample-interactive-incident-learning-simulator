package com.example.todoapp.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import com.example.todoapp.domain.Todo;

@Repository
public interface TodoRepository extends JpaRepository<Todo, Long> {
    // 基本的なCRUD操作はJpaRepositoryによって提供されます
    // 必要に応じて、カスタムクエリメソッドをここに追加できます
}
